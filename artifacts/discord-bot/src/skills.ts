// ---------------------------------------------------------------------------
// Skill Role Configuration
// ---------------------------------------------------------------------------
// Edit this file freely:
//   • Reorder entries        → run /refresh-roles
//   • Rename skills/roles    → run /refresh-roles (also rename roles in Discord!)
//   • Add a skill            → create the 3 Discord roles, add entry here,
//                              then run /setup-roles
//   • Remove a skill         → delete the entry (old embed becomes inert)
//   • Custom tier emojis     → set `tierEmojis` on any skill to override the
//                              default 1️⃣ 2️⃣ 3️⃣ for that skill only.
//                              For custom server emojis use the full string
//                              format e.g. "<:tankicon:1234567890>"
//
// Role names must match EXACTLY what you created in Discord server settings.
// ---------------------------------------------------------------------------

// Default tier emojis used by all skills that don't set their own
export const TIER_EMOJIS = ["1️⃣", "2️⃣", "3️⃣"] as const;

export interface SkillConfig {
  name: string;
  emoji: string;
  roles: [string, string, string]; // [slot-0 role name, slot-1, slot-2]
  // Optional: override the three reaction emojis for this skill only.
  // Must be exactly 3 items. Omit to use the default 1️⃣ 2️⃣ 3️⃣.
  tierEmojis?: [string, string, string];
}

export const SKILLS: SkillConfig[] = [
  {
    name: "Combat",
    emoji: "⚔️",
    roles: ["DPS", "Healer", "Tank"],
    // ⚔️ = DPS  |  ⚕️ = Healer  |  🛡️ = Tank
    // To use custom server emojis replace with e.g. "<:dps:1234567890>"
    tierEmojis: ["⚔️", "⚕️", "🛡️"],
  },
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

// ---------------------------------------------------------------------------
// Helpers used by the bot — no need to edit below this line
// ---------------------------------------------------------------------------

/** Returns the tier emojis for a skill (custom or default). */
export function getTierEmojis(skill: SkillConfig): [string, string, string] {
  return skill.tierEmojis ?? [TIER_EMOJIS[0], TIER_EMOJIS[1], TIER_EMOJIS[2]];
}

/**
 * Converts a Discord reaction emoji to the same string format used in the
 * config, so standard and custom server emojis both compare correctly.
 */
export function reactionEmojiKey(emoji: {
  name: string | null;
  id: string | null;
}): string {
  // Custom server emoji  →  "<:name:id>"
  if (emoji.id && emoji.name) return `<:${emoji.name}:${emoji.id}>`;
  // Standard Unicode emoji  →  the character itself
  return emoji.name ?? "";
}
