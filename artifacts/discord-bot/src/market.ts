const DATA_CDN = "https://data-cdn.gaming.tools/paxdei/market";

const CACHE_TTL_MS = 45 * 60 * 1000; // 45 minutes

interface CacheEntry<T> {
  data: T;
  fetchedAt: number;
}

export interface ItemMeta {
  id: string;
  name: { En?: string; [lang: string]: string | undefined };
  iconPath?: string;
  url?: string;
  stackSize?: number;
}

export interface Listing {
  id: string;
  avatar_hash: string;
  stall_hash: string;
  item_id: string;
  creation_date: number;
  quantity: number;
  price: number;
  lifetime: number;
  durability: number;
  world: string;
  domain: string;
  zone: string;
  last_seen: number;
}

export interface ItemMatch {
  id: string;
  name: string;
}

export interface ZoneSummary {
  domain: string;
  zone: string;
  quantity: number;
  minPrice: number;
  maxPrice: number;
}

export interface MarketResult {
  itemId: string;
  itemName: string;
  totalQuantity: number;
  globalMin: number;
  globalMax: number;
  byDomain: Map<string, ZoneSummary[]>;
  dataAge: number;
}

// ---------------------------------------------------------------------------
// Caches
// ---------------------------------------------------------------------------
let itemsCache: CacheEntry<Record<string, ItemMeta>> | null = null;
let sifZoneUrlsCache: CacheEntry<string[]> | null = null;
const zoneDataCache = new Map<string, CacheEntry<Listing[]>>();

async function fetchJson<T>(url: string): Promise<T> {
  const res = await fetch(url, { headers: { "User-Agent": "GrandExchangeBot/1.0" } });
  if (!res.ok) throw new Error(`HTTP ${res.status} fetching ${url}`);
  return res.json() as Promise<T>;
}

export async function getItems(): Promise<Record<string, ItemMeta>> {
  if (itemsCache && Date.now() - itemsCache.fetchedAt < CACHE_TTL_MS) {
    return itemsCache.data;
  }
  const data = await fetchJson<Record<string, ItemMeta>>(`${DATA_CDN}/items.json`);
  itemsCache = { data, fetchedAt: Date.now() };
  console.log(`📦 Loaded ${Object.keys(data).length} items from API`);
  return data;
}

async function getSifZoneUrls(): Promise<string[]> {
  if (sifZoneUrlsCache && Date.now() - sifZoneUrlsCache.fetchedAt < CACHE_TTL_MS) {
    return sifZoneUrlsCache.data;
  }
  const all = await fetchJson<string[]>(`${DATA_CDN}/index.json`);
  const sif = all.filter((u) => u.includes("/sif/"));
  sifZoneUrlsCache = { data: sif, fetchedAt: Date.now() };
  console.log(`🗺️ Found ${sif.length} Sif zones`);
  return sif;
}

async function getZoneData(url: string): Promise<Listing[]> {
  const cached = zoneDataCache.get(url);
  if (cached && Date.now() - cached.fetchedAt < CACHE_TTL_MS) {
    return cached.data;
  }
  const data = await fetchJson<Listing[]>(url);
  zoneDataCache.set(url, { data, fetchedAt: Date.now() });
  return data;
}

// ---------------------------------------------------------------------------
// Search item names
// ---------------------------------------------------------------------------
export async function searchItems(query: string): Promise<ItemMatch[]> {
  const items = await getItems();
  const q = query.toLowerCase().trim();
  if (!q) return [];

  const matches: ItemMatch[] = [];
  for (const [id, meta] of Object.entries(items)) {
    const name = meta.name?.En ?? "";
    if (!name) continue;
    if (name.toLowerCase().includes(q)) {
      matches.push({ id, name });
    }
  }

  matches.sort((a, b) => {
    const aLow = a.name.toLowerCase();
    const bLow = b.name.toLowerCase();
    if (aLow === q && bLow !== q) return -1;
    if (bLow === q && aLow !== q) return 1;
    if (aLow.startsWith(q) && !bLow.startsWith(q)) return -1;
    if (bLow.startsWith(q) && !aLow.startsWith(q)) return 1;
    return a.name.localeCompare(b.name);
  });

  return matches.slice(0, 25);
}

// ---------------------------------------------------------------------------
// Aggregate market data for a specific item across all Sif zones
// ---------------------------------------------------------------------------
export async function getMarketData(
  itemId: string,
  itemName: string
): Promise<MarketResult | null> {
  const zoneUrls = await getSifZoneUrls();

  const allListings = await Promise.all(
    zoneUrls.map((url) =>
      getZoneData(url).catch((err) => {
        console.error(`⚠️ Failed to fetch zone ${url}:`, err);
        return [] as Listing[];
      })
    )
  );

  const byZoneKey = new Map<string, ZoneSummary>();
  let globalMin = Infinity;
  let globalMax = -Infinity;
  let totalQuantity = 0;
  let newestSeen = 0;

  for (const listings of allListings) {
    for (const listing of listings) {
      if (listing.item_id !== itemId) continue;

      const key = `${listing.domain}/${listing.zone}`;
      const existing = byZoneKey.get(key);
      if (existing) {
        existing.quantity += listing.quantity;
        if (listing.price < existing.minPrice) existing.minPrice = listing.price;
        if (listing.price > existing.maxPrice) existing.maxPrice = listing.price;
      } else {
        byZoneKey.set(key, {
          domain: listing.domain,
          zone: listing.zone,
          quantity: listing.quantity,
          minPrice: listing.price,
          maxPrice: listing.price,
        });
      }

      if (listing.price < globalMin) globalMin = listing.price;
      if (listing.price > globalMax) globalMax = listing.price;
      totalQuantity += listing.quantity;
      if (listing.last_seen > newestSeen) newestSeen = listing.last_seen;
    }
  }

  if (totalQuantity === 0) return null;

  // Group by domain, sort zones within each domain by min price
  const byDomain = new Map<string, ZoneSummary[]>();
  for (const zone of byZoneKey.values()) {
    const existing = byDomain.get(zone.domain) ?? [];
    existing.push(zone);
    byDomain.set(zone.domain, existing);
  }
  for (const zones of byDomain.values()) {
    zones.sort((a, b) => a.minPrice - b.minPrice);
  }

  const dataAge = Math.max(0, Math.round(Date.now() / 1000 - newestSeen));

  return { itemId, itemName, totalQuantity, globalMin, globalMax, byDomain, dataAge };
}

// ---------------------------------------------------------------------------
// Formatting helpers
// ---------------------------------------------------------------------------
export function capitalize(s: string): string {
  return s
    .split("_")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

export function formatAge(seconds: number): string {
  if (seconds < 120) return `${seconds}s ago`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  return `${Math.floor(seconds / 3600)}h ${Math.floor((seconds % 3600) / 60)}m ago`;
}
