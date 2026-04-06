// ---------------------------------------------------------------------------
// Skill Role Configuration
// ---------------------------------------------------------------------------
// Edit this file freely:
//   • Reorder entries  → run /refresh-roles to update the channel order
//   • Rename skills    → run /refresh-roles (also rename the Discord roles!)
//   • Add a skill      → create the 3 Discord roles first, add entry here,
//                        then run /setup-roles to post the new embed
//   • Remove a skill   → delete the entry here (the old embed becomes inert
//                        but stays in the channel; delete it manually if needed)
//
// Role names must match EXACTLY what you created in Discord server settings.
// ---------------------------------------------------------------------------

export const TIER_EMOJIS = ["1️⃣", "2️⃣", "3️⃣"] as const;
export type TierEmoji = (typeof TIER_EMOJIS)[number];

export interface SkillConfig {
  name: string;
  emoji: string;
  roles: [string, string, string]; // [Tier 1 role name, Tier 2, Tier 3]
}

export const SKILLS: SkillConfig[] = [
  { name: "Combat",        emoji: "⚔️",  roles: ["DPS",        "Healer",        "Tank"]        },
  { name: "Magic",         emoji: "🔮",  roles: ["Magic I",         "Magic II",         "Magic III"]         },
  { name: "Archery",       emoji: "🏹",  roles: ["Archery I",       "Archery II",       "Archery III"]       },
  { name: "Alchemy",       emoji: "⚗️",  roles: ["Alchemy I",       "Alchemy II",       "Alchemy III"]       },
  { name: "Crafting",      emoji: "🔨",  roles: ["Crafting I",      "Crafting II",      "Crafting III"]      },
  { name: "Mining",        emoji: "⛏️",  roles: ["Mining I",        "Mining II",        "Mining III"]        },
  { name: "Fishing",       emoji: "🎣",  roles: ["Fishing I",       "Fishing II",       "Fishing III"]       },
  { name: "Cooking",       emoji: "🍳",  roles: ["Cooking I",       "Cooking II",       "Cooking III"]       },
  { name: "Herbalism",     emoji: "🌿",  roles: ["Herbalism I",     "Herbalism II",     "Herbalism III"]     },
  { name: "Enchanting",    emoji: "✨",  roles: ["Enchanting I",    "Enchanting II",    "Enchanting III"]    },
  { name: "Blacksmithing", emoji: "🪙",  roles: ["Blacksmithing I", "Blacksmithing II", "Blacksmithing III"] },
  { name: "Leatherworking",emoji: "🐂",  roles: ["Leatherworking I","Leatherworking II","Leatherworking III"]},
  { name: "Tailoring",     emoji: "🧵",  roles: ["Tailoring I",     "Tailoring II",     "Tailoring III"]     },
  { name: "Engineering",   emoji: "⚙️",  roles: ["Engineering I",   "Engineering II",   "Engineering III"]   },
  { name: "Farming",       emoji: "🌾",  roles: ["Farming I",       "Farming II",       "Farming III"]       },
  { name: "Hunting",       emoji: "🗡️",  roles: ["Hunting I",       "Hunting II",       "Hunting III"]       },
  { name: "Stealth",       emoji: "🌑",  roles: ["Stealth I",       "Stealth II",       "Stealth III"]       },
  { name: "Diplomacy",     emoji: "🤝",  roles: ["Diplomacy I",     "Diplomacy II",     "Diplomacy III"]     },
  { name: "Navigation",    emoji: "🧭",  roles: ["Navigation I",    "Navigation II",    "Navigation III"]    },
  { name: "Healing",       emoji: "💚",  roles: ["Healing I",       "Healing II",       "Healing III"]       },
];
