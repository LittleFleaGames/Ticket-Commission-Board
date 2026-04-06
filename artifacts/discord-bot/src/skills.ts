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
    roles: ["Combat 10-20", "Combat 21-30", "Combat 31-40"],
    // ⚔️ = DPS  |  ⚕️ = Healer  |  🛡️ = Tank
    // To use custom server emojis replace with e.g. "<:dps:1234567890>"
    tierEmojis: ["⚔️", "⚕️", "🛡️"],
  },
  { name: "Alchemy",               emoji: "⚗️",  roles: ["Alchemy 10-20",               "Alchemy 21-30",               "Alchemy 31-40"]               },
  { name: "Armorsmithing",         emoji: "🛡️",  roles: ["Armorsmithing 10-20",         "Armorsmithing 21-30",         "Armorsmithing 31-40"]         },
  { name: "Baking",                emoji: "🥖",  roles: ["Baking 10-20",                "Baking 21-30",                "Baking 31-40"]                },
  { name: "Blacksmithing",         emoji: "⚒️",  roles: ["Blacksmithing 10-20",         "Blacksmithing 21-30",         "Blacksmithing 31-40"]         },
  { name: "Butchering",            emoji: "🔪",  roles: ["Butchering 10-20",            "Butchering 21-30",            "Butchering 31-40"]            },
  { name: "Carpentry",             emoji: "🪵",  roles: ["Carpentry 10-20",             "Carpentry 21-30",             "Carpentry 31-40"]             },
  { name: "Cooking",               emoji: "🍳",  roles: ["Cooking 10-20",               "Cooking 21-30",               "Cooking 31-40"]               },
  { name: "Fletching",             emoji: "🏹",  roles: ["Fletching 10-20",             "Fletching 21-30",             "Fletching 31-40"]             },
  { name: "Jewelrymaking",         emoji: "💎",  roles: ["Jewelrymaking 10-20",         "Jewelrymaking 21-30",         "Jewelrymaking 31-40"]         },
  { name: "Leatherworking",        emoji: "🐄",  roles: ["Leatherworking 10-20",        "Leatherworking 21-30",        "Leatherworking 31-40"]        },
  { name: "Mining",                emoji: "⛏️",  roles: ["Mining 10-20",                "Mining 21-30",                "Mining 31-40"]                },
  { name: "Skinning",              emoji: "🦌",  roles: ["Skinning 10-20",              "Skinning 21-30",              "Skinning 31-40"]              },
  { name: "Tailoring",             emoji: "🧵",  roles: ["Tailoring 10-20",             "Tailoring 21-30",             "Tailoring 31-40"]             },
  { name: "Weaponsmithing",        emoji: "🗡️",  roles: ["Weaponsmithing 10-20",        "Weaponsmithing 21-30",        "Weaponsmithing 31-40"]        },
  { name: "Winemaking and Brewing",emoji: "🍷",  roles: ["Winemaking and Brewing 10-20","Winemaking and Brewing 21-30","Winemaking and Brewing 31-40"]},
  { name: "Woodcutting",           emoji: "🪓",  roles: ["Woodcutting 10-20",           "Woodcutting 21-30",           "Woodcutting 31-40"]           },
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
