import {
  Client,
  GatewayIntentBits,
  Events,
  EmbedBuilder,
  ButtonBuilder,
  ButtonStyle,
  ActionRowBuilder,
  ChannelType,
  ForumChannel,
  ButtonInteraction,
  ThreadChannel,
  TextChannel,
  Partials,
  REST,
  Routes,
  SlashCommandBuilder,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  ModalSubmitInteraction,
  ChatInputCommandInteraction,
  PermissionFlagsBits,
  Guild,
  RoleSelectMenuBuilder,
  RoleSelectMenuInteraction,
  Role,
  StringSelectMenuBuilder,
  StringSelectMenuOptionBuilder,
  StringSelectMenuInteraction,
  UserSelectMenuBuilder,
  UserSelectMenuInteraction,
  Message,
} from "discord.js";
import {
  createChallenge,
  createStep,
  getChallengeByChannel,
  getChallengeById,
  updateChallengeMessageId,
  markChallengeCompleted,
  getAllActiveChallenges,
  getSteps,
  getStepById,
  clearStep as dbClearStep,
  addStepParticipants,
  getStepParticipants,
  addReputation,
  getReputation,
  getLeaderboard,
  upsertRoleMessage,
  getRoleMessage,
  getSkillByMessage,
  upsertPendingDeletion,
  cancelPendingDeletion,
  getAllPendingDeletions,
} from "./db.js";
import { SKILLS, TIER_EMOJIS, getTierEmojis, reactionEmojiKey } from "./skills.js";

const DISCORD_BOT_TOKEN = process.env["DISCORD_BOT_TOKEN"];
const FORUM_CHANNEL_ID = process.env["FORUM_CHANNEL_ID"];
const POST_A_QUEST_CHANNEL_ID = "1486847104457638009";
const COMMISSION_CATEGORY_ID = "1486848687706738889";
const DELETE_AFTER_MS = 24 * 60 * 60 * 1000; // 24 hours

// Reputation point values
const REP_QUEST_ACCEPT = 10;
const REP_DUNGEON_CLEAR = 5;

// Role name that can report dungeon clears (case-insensitive match)
const LEADER_ROLE_NAME = "Quest Leader";

if (!DISCORD_BOT_TOKEN) throw new Error("DISCORD_BOT_TOKEN is required");
if (!FORUM_CHANNEL_ID) throw new Error("FORUM_CHANNEL_ID is required");

// ---------------------------------------------------------------------------
// In-memory stores
// ---------------------------------------------------------------------------
interface PendingDeletion {
  timeout: ReturnType<typeof setTimeout>;
  requesterId: string;
  privateChannelId: string | null;
}
const pendingDeletions = new Map<string, PendingDeletion>(); // threadId → data

interface PendingForm {
  commissionType: string;
  description: string;
  budget: string;
  deadline: string;
}
const pendingForms = new Map<string, PendingForm>(); // userId → form data

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessageReactions,
  ],
  partials: [
    Partials.Channel,
    Partials.Message,
    Partials.Reaction,
    Partials.User,
  ],
});

// ---------------------------------------------------------------------------
// Slash command definitions
// ---------------------------------------------------------------------------
const commissionCommand = new SlashCommandBuilder()
  .setName("commission")
  .setDescription("Post a quest request — a forum thread will be created for you");

const setupCommand = new SlashCommandBuilder()
  .setName("setup")
  .setDescription("Post the quest board embed in this channel (admin only)")
  .setDefaultMemberPermissions(PermissionFlagsBits.Administrator.toString());

const testAcceptCommand = new SlashCommandBuilder()
  .setName("testaccept")
  .setDescription("Admin only: simulate a quest acceptance to test private channel creation")
  .setDefaultMemberPermissions(PermissionFlagsBits.Administrator.toString());

const challengeCommand = new SlashCommandBuilder()
  .setName("challenge")
  .setDescription("World challenge commands")
  .addSubcommand((sub) =>
    sub
      .setName("create")
      .setDescription("Post a world challenge in this channel (admin only)")
      .addStringOption((o) =>
        o.setName("name").setDescription("Challenge title").setRequired(true).setMaxLength(100)
      )
      .addStringOption((o) =>
        o.setName("deadline").setDescription("Deadline (e.g. April 30, 2026)").setRequired(true).setMaxLength(100)
      )
      .addStringOption((o) =>
        o.setName("steps").setDescription("Comma-separated list of steps (e.g. Dungeon 1, Dungeon 2, ...)").setRequired(true).setMaxLength(1000)
      )
  )
  .setDefaultMemberPermissions(PermissionFlagsBits.Administrator.toString());

const repCommand = new SlashCommandBuilder()
  .setName("rep")
  .setDescription("Check reputation points")
  .addUserOption((o) =>
    o.setName("user").setDescription("Member to check (leave blank for yourself)").setRequired(false)
  );

const leaderboardCommand = new SlashCommandBuilder()
  .setName("leaderboard")
  .setDescription("Show the top 10 contributors on this server");

const setupRolesCommand = new SlashCommandBuilder()
  .setName("setup-roles")
  .setDescription("Post skill role selection embeds in a channel (admin only)")
  .addChannelOption((o) =>
    o.setName("channel").setDescription("Channel to post the skill embeds in").setRequired(true)
  )
  .setDefaultMemberPermissions(PermissionFlagsBits.Administrator.toString());

const refreshRolesCommand = new SlashCommandBuilder()
  .setName("refresh-roles")
  .setDescription("Edit existing skill embeds with the current config — no repost needed (admin only)")
  .setDefaultMemberPermissions(PermissionFlagsBits.Administrator.toString());

// ---------------------------------------------------------------------------
// Shared embed builder for a single skill
// ---------------------------------------------------------------------------
function buildSkillEmbed(skill: (typeof SKILLS)[number]): EmbedBuilder {
  const te = getTierEmojis(skill);
  return new EmbedBuilder()
    .setColor(0xf1c40f)
    .setTitle(`${skill.emoji}  ${skill.name}`)
    .setDescription(
      `React to choose your **${skill.name}** proficiency:\n\n` +
        `${te[0]} — **${skill.roles[0]}**\n` +
        `${te[1]} — **${skill.roles[1]}**\n` +
        `${te[2]} — **${skill.roles[2]}**`
    )
    .setFooter({ text: "React to any tier to receive that role. Remove your reaction to drop it." });
}

// ---------------------------------------------------------------------------
// Register slash commands for all guilds the bot is in
// ---------------------------------------------------------------------------
async function registerCommands(guildId: string): Promise<void> {
  const rest = new REST({ version: "10" }).setToken(DISCORD_BOT_TOKEN!);
  const appId = client.application?.id;
  if (!appId) return;

  try {
    await rest.put(Routes.applicationGuildCommands(appId, guildId), {
      body: [
        commissionCommand.toJSON(),
        setupCommand.toJSON(),
        testAcceptCommand.toJSON(),
        challengeCommand.toJSON(),
        repCommand.toJSON(),
        leaderboardCommand.toJSON(),
        setupRolesCommand.toJSON(),
        refreshRolesCommand.toJSON(),
      ],
    });
    console.log(`✅ Slash commands registered for guild ${guildId}`);
  } catch (err) {
    console.error(`❌ Failed to register commands for guild ${guildId}:`, err);
  }
}

client.once(Events.ClientReady, async (readyClient) => {
  console.log(`✅ Bot ready! Logged in as ${readyClient.user.tag}`);
  console.log(`🗂️  Forum channel: ${FORUM_CHANNEL_ID}`);
  for (const guild of readyClient.guilds.cache.values()) {
    await registerCommands(guild.id);
  }

  // Re-schedule deadline checks for all active challenges that survived a restart
  const active = getAllActiveChallenges();
  for (const c of active) {
    scheduleDeadlineCheck(c.id, c.deadline_ts);
    console.log(`⏰ Re-scheduled deadline for challenge "${c.name}" (${c.id})`);
  }

  // Restore pending thread deletions that survived a restart
  const pendingRows = getAllPendingDeletions();
  for (const row of pendingRows) {
    try {
      const guild = readyClient.guilds.cache.get(row.guild_id);
      if (!guild) { cancelPendingDeletion(row.thread_id); continue; }
      const channel = await guild.channels.fetch(row.thread_id).catch(() => null);
      if (!channel) {
        // Thread is already gone — clean up DB entry
        cancelPendingDeletion(row.thread_id);
        console.log(`🗑️ Thread ${row.thread_id} already deleted — cleared from DB`);
        continue;
      }
      scheduleDeletion(
        channel as ThreadChannel,
        row.requester_id,
        row.private_channel_id,
        row.delete_at
      );
    } catch (err) {
      console.error(`❌ Failed to restore deletion for thread ${row.thread_id}:`, err);
      cancelPendingDeletion(row.thread_id);
    }
  }
  console.log(`🔄 Restored ${pendingRows.length} pending deletion(s) from DB`);
});

client.on(Events.GuildCreate, async (guild) => {
  console.log(`📥 Joined new guild: ${guild.name}`);
  await registerCommands(guild.id);
});

// ---------------------------------------------------------------------------
// Utility: progress bar
// ---------------------------------------------------------------------------
function makeProgressBar(done: number, total: number, width = 20): string {
  if (total === 0) return "░".repeat(width);
  const filled = Math.round((done / total) * width);
  return "█".repeat(filled) + "░".repeat(width - filled);
}

// ---------------------------------------------------------------------------
// Utility: check if a guild member has the Leader role OR is an admin
// ---------------------------------------------------------------------------
function isLeader(
  member: import("discord.js").GuildMember | null | undefined
): boolean {
  if (!member) return false;
  if (member.permissions.has(PermissionFlagsBits.Administrator)) return true;
  return member.roles.cache.some(
    (r) => r.name.toLowerCase() === LEADER_ROLE_NAME.toLowerCase()
  );
}

// ---------------------------------------------------------------------------
// Build the challenge embed + action row (can be called to refresh it)
// ---------------------------------------------------------------------------
function buildChallengeEmbed(
  challengeId: string
): { embed: EmbedBuilder; row: ActionRowBuilder<ButtonBuilder> } {
  const challenge = getChallengeById(challengeId)!;
  const steps = getSteps(challengeId);

  const cleared = steps.filter((s) => s.cleared).length;
  const total = steps.length;
  const pct = total > 0 ? Math.round((cleared / total) * 100) : 0;
  const bar = makeProgressBar(cleared, total);

  const deadlineTs = Math.floor(challenge.deadline_ts / 1000);
  const allDone = cleared === total;

  let description =
    `⏰ **Deadline:** <t:${deadlineTs}:D> (<t:${deadlineTs}:R>)\n` +
    `**Progress: ${cleared}/${total} completed** · ${bar} ${pct}%\n\n`;

  for (const step of steps) {
    if (step.cleared) {
      const participants = getStepParticipants(step.id);
      const count = participants.length;
      const clearedTs = Math.floor((step.cleared_at ?? 0) / 1000);
      description += `✅ **${step.name}** · ${count} adventurer${count !== 1 ? "s" : ""} · <t:${clearedTs}:d>\n`;
    } else {
      description += `⏳ **${step.name}**\n`;
    }
  }

  const embed = new EmbedBuilder()
    .setColor(allDone ? 0x57f287 : 0xf1c40f)
    .setTitle(`🌍 ${challenge.name}`)
    .setDescription(description.trim())
    .setFooter({
      text: allDone
        ? "🎉 Challenge complete!"
        : `Only "Quest Leader" role members can report a clear`,
    })
    .setTimestamp();

  const reportButton = new ButtonBuilder()
    .setCustomId(`report_clear_${challengeId}`)
    .setLabel("📋 Report a Clear")
    .setStyle(ButtonStyle.Primary)
    .setDisabled(allDone);

  const row = new ActionRowBuilder<ButtonBuilder>().addComponents(reportButton);
  return { embed, row };
}

// ---------------------------------------------------------------------------
// Schedule deadline failure message for a challenge
// ---------------------------------------------------------------------------
function scheduleDeadlineCheck(
  challengeId: string,
  deadlineTs: number
): void {
  const delay = deadlineTs - Date.now();
  if (delay <= 0) return; // already passed

  setTimeout(async () => {
    const challenge = getChallengeById(challengeId);
    if (!challenge || challenge.completed) return;

    const steps = getSteps(challengeId);
    const cleared = steps.filter((s) => s.cleared).length;
    if (cleared === steps.length) return; // completed just in time

    markChallengeCompleted(challengeId);

    try {
      const channel = await client.channels.fetch(challenge.channel_id);
      if (!channel || !channel.isTextBased()) return;

      const failEmbed = new EmbedBuilder()
        .setColor(0xed4245)
        .setTitle("❌ Challenge Failed")
        .setDescription(
          `The deadline has passed for **${challenge.name}**.\n` +
            `Only **${cleared}/${steps.length}** steps were completed.`
        )
        .setTimestamp();

      await (channel as TextChannel).send({ embeds: [failEmbed] });
      console.log(`⏰ Challenge ${challengeId} expired — ${cleared}/${steps.length} cleared`);
    } catch (err) {
      console.error(`❌ Failed to send challenge expiry message:`, err);
    }
  }, Math.min(delay, 2_147_483_647)); // cap at max 32-bit int to avoid setTimeout overflow
}

// ---------------------------------------------------------------------------
// Create a private text channel between requester, acceptor, and admins
// ---------------------------------------------------------------------------
async function createPrivateCommissionChannel(
  guild: Guild,
  requesterId: string,
  acceptorId: string,
  threadId: string,
  requesterName: string,
  acceptorName: string
): Promise<TextChannel | null> {
  try {
    const botId = client.user!.id;

    // Verify the target category exists and is actually a category
    try {
      const targetCategory = await guild.channels.fetch(COMMISSION_CATEGORY_ID);
      if (!targetCategory) {
        console.error(`❌ Category ${COMMISSION_CATEGORY_ID} not found in guild`);
      } else {
        console.log(`📁 Target category: "${targetCategory.name}" (type: ${targetCategory.type}, id: ${targetCategory.id})`);
      }
    } catch (err) {
      console.error(`❌ Could not fetch category ${COMMISSION_CATEGORY_ID}:`, err);
    }

    const adminRoles = guild.roles.cache.filter((role) =>
      role.permissions.has(PermissionFlagsBits.Administrator)
    );

    // Sanitize usernames for Discord channel name (lowercase, alphanumeric + hyphens only)
    const sanitize = (name: string) =>
      name.toLowerCase().replace(/[^a-z0-9]/g, "-").replace(/-+/g, "-").slice(0, 20);
    const channelName = `quest-${sanitize(requesterName)}-${sanitize(acceptorName)}`.slice(0, 100);

    const channel = await guild.channels.create({
      name: channelName,
      type: ChannelType.GuildText,
      parent: COMMISSION_CATEGORY_ID,
      permissionOverwrites: [
        { id: guild.roles.everyone.id, deny: [PermissionFlagsBits.ViewChannel] },
        {
          id: botId,
          allow: [
            PermissionFlagsBits.ViewChannel,
            PermissionFlagsBits.SendMessages,
            PermissionFlagsBits.ManageChannels,
          ],
        },
        {
          id: requesterId,
          allow: [
            PermissionFlagsBits.ViewChannel,
            PermissionFlagsBits.SendMessages,
            PermissionFlagsBits.ReadMessageHistory,
          ],
        },
        {
          id: acceptorId,
          allow: [
            PermissionFlagsBits.ViewChannel,
            PermissionFlagsBits.SendMessages,
            PermissionFlagsBits.ReadMessageHistory,
          ],
        },
        ...adminRoles.map((role) => ({
          id: role.id,
          allow: [
            PermissionFlagsBits.ViewChannel,
            PermissionFlagsBits.SendMessages,
            PermissionFlagsBits.ReadMessageHistory,
            PermissionFlagsBits.ManageChannels,
          ],
        })),
      ],
    });

    const welcomeEmbed = new EmbedBuilder()
      .setColor(0x57f287)
      .setTitle("⚔️ Quest Accepted — Private Channel")
      .setDescription(
        `Welcome! This is your private channel for this quest.\n\n` +
          `**Requester:** <@${requesterId}>\n` +
          `**Acceptor:** <@${acceptorId}>\n\n` +
          `Discuss the details here. Original quest thread: <#${threadId}>\n\n` +
          `When the work is done, <@${requesterId}> can click **Complete Quest** below to close this channel and mark the quest as finished.`
      )
      .setFooter({ text: "This channel auto-deletes 24h after acceptance if not completed" })
      .setTimestamp();

    const completeButton = new ButtonBuilder()
      .setCustomId(`complete_quest_${requesterId}_${acceptorId}_${threadId}`)
      .setLabel("✅ Complete Quest")
      .setStyle(ButtonStyle.Success);

    await channel.send({
      embeds: [welcomeEmbed],
      components: [new ActionRowBuilder<ButtonBuilder>().addComponents(completeButton)],
    });
    console.log(`✅ Created private channel: "${channel.name}" (${channel.id})`);
    console.log(`📁 Channel placed in category: ${channel.parentId ?? "no category"}`);
    return channel;
  } catch (err) {
    console.error("❌ Failed to create private channel:", err);
    return null;
  }
}

// ---------------------------------------------------------------------------
// Schedule a thread for deletion after 24 hours
// ---------------------------------------------------------------------------
function scheduleDeletion(
  thread: ThreadChannel,
  requesterId: string,
  privateChannelId: string | null,
  deleteAt?: number  // optional: supply a specific timestamp (for restoring from DB)
): void {
  const existing = pendingDeletions.get(thread.id);
  if (existing) clearTimeout(existing.timeout);

  const now = Date.now();
  const resolvedDeleteAt = deleteAt ?? now + DELETE_AFTER_MS;
  const delay = Math.max(0, resolvedDeleteAt - now);

  // Persist so the timer survives restarts
  upsertPendingDeletion(
    thread.id,
    thread.guildId,
    requesterId,
    privateChannelId,
    resolvedDeleteAt
  );

  const timeout = setTimeout(async () => {
    try {
      pendingDeletions.delete(thread.id);
      cancelPendingDeletion(thread.id);
      await thread.delete("Auto-deleted 24 hours after quest acceptance");
      console.log(`🗑️ Auto-deleted thread: ${thread.id}`);
    } catch (err) {
      console.error(`❌ Failed to auto-delete thread ${thread.id}:`, err);
    }
  }, delay);

  pendingDeletions.set(thread.id, { timeout, requesterId, privateChannelId });
  console.log(
    delay === 0
      ? `🗑️ Thread ${thread.id} is overdue — deleting immediately`
      : `⏳ Thread ${thread.id} scheduled for deletion in ${Math.round(delay / 60000)}min`
  );
}

// ---------------------------------------------------------------------------
// Create the forum thread (shared between role-select and skip paths)
// ---------------------------------------------------------------------------
async function createQuestThread(
  userId: string,
  username: string,
  avatarURL: string,
  form: PendingForm,
  professionRole: Role | null
): Promise<string | null> {
  try {
    const forumChannel = await client.channels.fetch(FORUM_CHANNEL_ID!);
    if (!forumChannel || forumChannel.type !== ChannelType.GuildForum) return null;

    const forum = forumChannel as ForumChannel;
    const threadTitle = `[${form.commissionType}] — ${username}`.slice(0, 100);

    const embed = new EmbedBuilder()
      .setColor(0x5865f2)
      .setTitle("📋 Quest Request")
      .setAuthor({ name: username, iconURL: avatarURL })
      .addFields(
        { name: "⚔️ Quest Type", value: form.commissionType, inline: true },
        { name: "💰 Budget", value: form.budget, inline: true },
        { name: "⏰ Deadline", value: form.deadline, inline: true },
        { name: "📝 Description", value: form.description, inline: false }
      )
      .setTimestamp()
      .setFooter({ text: "Click Accept below to take this quest" });

    if (professionRole) {
      embed.addFields({
        name: "🎓 Profession Required",
        value: `<@&${professionRole.id}>`,
        inline: false,
      });
    }

    const acceptButton = new ButtonBuilder()
      .setCustomId(`accept_commission_${userId}`)
      .setLabel("✅ Accept Quest")
      .setStyle(ButtonStyle.Success);

    const professionLine = professionRole
      ? `**🎓 Profession Required:** <@&${professionRole.id}> · `
      : "";

    const previewText =
      `**⚔️ Quest Type:** ${form.commissionType}\n` +
      `**📝 What's needed:** ${form.description}\n` +
      `${professionLine}**💰 Budget:** ${form.budget} · **⏰ Deadline:** ${form.deadline}`;

    const thread = await forum.threads.create({
      name: threadTitle,
      message: {
        content: previewText,
        embeds: [embed],
        components: [new ActionRowBuilder<ButtonBuilder>().addComponents(acceptButton)],
      },
    });

    console.log(`✅ Created forum thread: "${threadTitle}" (${thread.id}) by ${username}`);
    return thread.id;
  } catch (err) {
    console.error("❌ Failed to create forum thread:", err);
    return null;
  }
}

// ---------------------------------------------------------------------------
// Handle interactions
// ---------------------------------------------------------------------------
client.on(Events.InteractionCreate, async (interaction) => {

  // --- /setup command → post the quest board embed ---
  if (interaction.isChatInputCommand() && interaction.commandName === "setup") {
    const cmd = interaction as ChatInputCommandInteraction;

    const embed = new EmbedBuilder()
      .setColor(0x5865f2)
      .setTitle("🌟 Welcome to the Post-a-Quest Channel! 🌟")
      .setDescription(
        "Ready to embark on an exciting quest? Here's how it works:\n\n" +
        "**Submit Your Quest:** Use the command /commission to open a form where you can enter all the necessary details about your quest. 🎉\n\n" +
        "**Quest Approval:** Once submitted, a forum thread will automatically open in the Grand Exchange Forum for your quest to be reviewed! 📜\n\n" +
        "**Connect with Your Client:** Once your quest is accepted, a dedicated room will be opened, allowing you to communicate directly with your client. 🤝💬\n\n" +
        "if a quest need to be reopened just head back to the previously accepted quest in grand exchange and click the reopen button!✨"
      );

    const postButton = new ButtonBuilder()
      .setCustomId("open_commission_modal")
      .setLabel("📜 Post a Quest")
      .setStyle(ButtonStyle.Primary);

    await cmd.reply({
      embeds: [embed],
      components: [new ActionRowBuilder<ButtonBuilder>().addComponents(postButton)],
    });
    return;
  }

  // --- /testaccept command → simulate full accept flow for testing ---
  if (interaction.isChatInputCommand() && interaction.commandName === "testaccept") {
    const cmd = interaction as ChatInputCommandInteraction;
    const guild = cmd.guild;
    if (!guild) return;

    await cmd.deferReply({ flags: 1 << 6 });

    // Create a real test forum thread so we have a valid thread ID
    try {
      const forumChannel = await client.channels.fetch(FORUM_CHANNEL_ID!);
      if (!forumChannel || forumChannel.type !== ChannelType.GuildForum) {
        await cmd.editReply({ content: "❌ Forum channel not found or not a forum." });
        return;
      }

      const forum = forumChannel as ForumChannel;
      const thread = await forum.threads.create({
        name: `[TEST] Quest — ${cmd.user.username}`,
        message: {
          content: "🧪 This is a test quest created by `/testaccept`. It will be deleted shortly.",
        },
      });

      console.log(`🧪 Test thread created: ${thread.id}`);

      // Use the command user as requester and the bot itself as acceptor
      const requesterId = cmd.user.id;
      const acceptorId = client.user!.id;

      const privateChannel = await createPrivateCommissionChannel(
        guild,
        requesterId,
        acceptorId,
        thread.id,
        cmd.user.username,
        client.user!.username
      );

      if (privateChannel) {
        await cmd.editReply({
          content:
            `✅ Test passed! Private channel created: <#${privateChannel.id}>\n` +
            `Check the bot console logs for the category diagnostic info.`,
        });
      } else {
        await cmd.editReply({
          content: "❌ Private channel creation failed — check the bot console logs for details.",
        });
      }

      // Clean up the test thread after 10 seconds
      setTimeout(() => thread.delete("Test quest cleanup").catch(() => {}), 10_000);
    } catch (err) {
      console.error("❌ /testaccept failed:", err);
      await cmd.editReply({ content: `❌ Error: ${String(err)}` });
    }
    return;
  }

  // --- /challenge create → post world challenge embed in current channel ---
  if (
    interaction.isChatInputCommand() &&
    interaction.commandName === "challenge" &&
    interaction.options.getSubcommand(false) === "create"
  ) {
    const cmd = interaction as ChatInputCommandInteraction;
    const guild = cmd.guild;
    if (!guild) return;

    await cmd.deferReply({ flags: 1 << 6 });

    const existing = getChallengeByChannel(cmd.channelId);
    if (existing && !existing.completed) {
      await cmd.editReply({
        content: "❌ This channel already has an active challenge. Create a new channel for another one.",
      });
      return;
    }

    const name = cmd.options.getString("name", true);
    const deadlineText = cmd.options.getString("deadline", true);
    const stepsRaw = cmd.options.getString("steps", true);

    const deadlineDate = new Date(deadlineText);
    if (isNaN(deadlineDate.getTime())) {
      await cmd.editReply({
        content: `❌ Could not parse the deadline "${deadlineText}". Try a format like "April 30, 2026" or "2026-04-30".`,
      });
      return;
    }

    const stepNames = stepsRaw
      .split(",")
      .map((s) => s.trim())
      .filter((s) => s.length > 0);

    if (stepNames.length === 0) {
      await cmd.editReply({ content: "❌ Please provide at least one step." });
      return;
    }
    if (stepNames.length > 25) {
      await cmd.editReply({ content: "❌ Maximum 25 steps per challenge." });
      return;
    }

    const challengeId = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    createChallenge(
      challengeId,
      guild.id,
      cmd.channelId,
      name,
      deadlineText,
      deadlineDate.getTime()
    );

    for (let i = 0; i < stepNames.length; i++) {
      const stepId = `${challengeId}-${i}`;
      createStep(stepId, challengeId, stepNames[i]!, i);
    }

    const { embed, row } = buildChallengeEmbed(challengeId);

    // Post the challenge embed in the channel
    const channel = cmd.channel as TextChannel;
    const msg = await channel.send({ embeds: [embed], components: [row] });

    // Pin it so it stays visible
    try {
      await msg.pin();
    } catch { /* not critical */ }

    updateChallengeMessageId(challengeId, msg.id);
    scheduleDeadlineCheck(challengeId, deadlineDate.getTime());

    await cmd.editReply({
      content: `✅ World challenge **${name}** created with ${stepNames.length} steps!`,
    });

    console.log(
      `🌍 Challenge "${name}" (${challengeId}) created in channel ${cmd.channelId} with ${stepNames.length} steps`
    );
    return;
  }

  // --- /rep → show reputation ---
  if (interaction.isChatInputCommand() && interaction.commandName === "rep") {
    const cmd = interaction as ChatInputCommandInteraction;
    const target = cmd.options.getUser("user") ?? cmd.user;
    const guildId = cmd.guildId;
    if (!guildId) return;

    const rep = getReputation(target.id, guildId);
    const points = rep?.points ?? 0;
    const isSelf = target.id === cmd.user.id;

    const embed = new EmbedBuilder()
      .setColor(0x5865f2)
      .setTitle(`⭐ ${target.username}'s Reputation`)
      .setThumbnail(target.displayAvatarURL())
      .setDescription(
        `${isSelf ? "You have" : `**${target.username}** has`} **${points} reputation point${points !== 1 ? "s" : ""}**.`
      )
      .setFooter({ text: "+10 for accepting a quest · +5 per dungeon clear" });

    await cmd.reply({ embeds: [embed], flags: 1 << 6 });
    return;
  }

  // --- /leaderboard → top 10 contributors ---
  if (interaction.isChatInputCommand() && interaction.commandName === "leaderboard") {
    const cmd = interaction as ChatInputCommandInteraction;
    const guildId = cmd.guildId;
    if (!guildId) return;

    const top = getLeaderboard(guildId, 10);

    const embed = new EmbedBuilder()
      .setColor(0xf1c40f)
      .setTitle("🏆 Top Contributors");

    if (top.length === 0) {
      embed.setDescription("No reputation earned yet. Accept quests and clear dungeons to climb the ranks!");
    } else {
      const medals = ["🥇", "🥈", "🥉"];
      const lines = top.map((r, i) => {
        const medal = medals[i] ?? `**${i + 1}.**`;
        return `${medal} **${r.username}** — ${r.points} pts`;
      });
      embed.setDescription(lines.join("\n"));
    }

    await cmd.reply({ embeds: [embed] });
    return;
  }

  // --- /setup-roles → post skill embeds in a channel ---
  if (interaction.isChatInputCommand() && interaction.commandName === "setup-roles") {
    const cmd = interaction as ChatInputCommandInteraction;
    const guildId = cmd.guildId;
    if (!guildId) return;

    const channel = cmd.options.getChannel("channel", true) as TextChannel;
    await cmd.deferReply({ flags: 1 << 6 });

    let posted = 0;
    let skipped = 0;
    let failed = 0;
    const failedNames: string[] = [];

    for (const skill of SKILLS) {
      const existing = getRoleMessage(skill.name, guildId);
      if (existing) {
        skipped++;
        continue;
      }

      try {
        const msg = await channel.send({ embeds: [buildSkillEmbed(skill)] });
        for (const emoji of getTierEmojis(skill)) {
          await msg.react(emoji);
        }
        upsertRoleMessage(skill.name, guildId, channel.id, msg.id);
        posted++;
      } catch (err: any) {
        console.error(`❌ Failed to post embed for skill "${skill.name}":`, err);
        failed++;
        failedNames.push(skill.name);
      }
    }

    const lines: string[] = [];
    if (posted > 0) lines.push(`✅ Posted **${posted}** skill embed${posted !== 1 ? "s" : ""}`);
    if (skipped > 0) lines.push(`⏭️ Skipped **${skipped}** already posted — use \`/refresh-roles\` to update them`);
    if (failed > 0) lines.push(`❌ Failed **${failed}** — bot is missing permissions in this channel.\nFailed skills: ${failedNames.join(", ")}\n\nFix: channel settings → Permissions → give Grand Exchange **View Channel**, **Send Messages**, **Add Reactions**, **Read Message History**`);
    if (lines.length === 0) lines.push("Nothing to post — all skills already set up.");

    await cmd.editReply({ content: lines.join("\n") });
    return;
  }

  // --- /refresh-roles → edit existing skill embeds without reposting ---
  if (interaction.isChatInputCommand() && interaction.commandName === "refresh-roles") {
    const cmd = interaction as ChatInputCommandInteraction;
    const guildId = cmd.guildId;
    if (!guildId) return;

    await cmd.deferReply({ flags: 1 << 6 });

    let updated = 0;
    let failed = 0;
    let notFound = 0;

    for (const skill of SKILLS) {
      const record = getRoleMessage(skill.name, guildId);
      if (!record) {
        notFound++;
        continue;
      }

      try {
        const ch = (await client.channels.fetch(record.channel_id)) as TextChannel;
        const msg = await ch.messages.fetch(record.message_id);
        // Update embed content
        await msg.edit({ embeds: [buildSkillEmbed(skill)] });
        // Refresh reactions: remove all bot reactions, re-add current tier emojis
        await msg.reactions.removeAll();
        for (const emoji of getTierEmojis(skill)) {
          await msg.react(emoji);
        }
        updated++;
      } catch (err) {
        console.error(`❌ Failed to refresh embed for "${skill.name}":`, err);
        failed++;
      }
    }

    await cmd.editReply({
      content:
        `✅ Refreshed **${updated}** embed${updated !== 1 ? "s" : ""}` +
        (notFound > 0 ? ` · **${notFound}** not yet posted (run \`/setup-roles\` to add them)` : "") +
        (failed > 0 ? ` · ⚠️ **${failed}** failed (message may have been deleted)` : "") +
        ".",
    });
    return;
  }

  // --- "📋 Report a Clear" button → show step selector (leaders only) ---
  if (interaction.isButton() && interaction.customId.startsWith("report_clear_")) {
    const btn = interaction as ButtonInteraction;
    const guild = btn.guild;
    if (!guild) return;

    if (!isLeader(btn.member as import("discord.js").GuildMember)) {
      await btn.reply({
        content: `❌ Only members with the **${LEADER_ROLE_NAME}** role (or admins) can report a clear.`,
        flags: 1 << 6,
      });
      return;
    }

    const challengeId = btn.customId.replace("report_clear_", "");
    const steps = getSteps(challengeId);
    const unclearedSteps = steps.filter((s) => !s.cleared);

    if (unclearedSteps.length === 0) {
      await btn.reply({ content: "🎉 All steps are already cleared!", flags: 1 << 6 });
      return;
    }

    const stepSelect = new StringSelectMenuBuilder()
      .setCustomId(`step_select_${challengeId}`)
      .setPlaceholder("Which dungeon/step was cleared?")
      .addOptions(
        unclearedSteps.map((s) =>
          new StringSelectMenuOptionBuilder().setLabel(s.name).setValue(s.id)
        )
      );

    await btn.reply({
      content: "**Step 1/2** — Which step was cleared?",
      components: [
        new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(stepSelect),
      ],
      flags: 1 << 6,
    });
    return;
  }

  // --- Step select menu → show participant picker ---
  if (
    interaction.isStringSelectMenu() &&
    interaction.customId.startsWith("step_select_")
  ) {
    const select = interaction as StringSelectMenuInteraction;
    const challengeId = select.customId.replace("step_select_", "");
    const stepId = select.values[0]!;
    const step = getStepById(stepId);
    if (!step) {
      await select.reply({ content: "❌ Step not found.", flags: 1 << 6 });
      return;
    }

    const participantSelect = new UserSelectMenuBuilder()
      .setCustomId(`participants_select_${challengeId}_${stepId}`)
      .setPlaceholder("Select all participants...")
      .setMinValues(1)
      .setMaxValues(25);

    await select.update({
      content: `**Step 2/2** — **${step.name}** was cleared! Who participated? Select all members:`,
      components: [
        new ActionRowBuilder<UserSelectMenuBuilder>().addComponents(
          participantSelect
        ),
      ],
    });
    return;
  }

  // --- Participant select menu → record clear and update embed ---
  if (
    interaction.isUserSelectMenu() &&
    interaction.customId.startsWith("participants_select_")
  ) {
    const select = interaction as UserSelectMenuInteraction;
    const [, , challengeId, stepId] = select.customId.split("_") as [
      string,
      string,
      string,
      string
    ];

    const guild = select.guild;
    if (!guild || !challengeId || !stepId) return;

    const challenge = getChallengeById(challengeId);
    const step = getStepById(stepId);
    if (!challenge || !step) {
      await select.update({ content: "❌ Challenge or step not found.", components: [] });
      return;
    }

    if (step.cleared) {
      await select.update({ content: "❌ This step was already cleared.", components: [] });
      return;
    }

    // Record the clear
    dbClearStep(stepId, select.user.id, select.user.username);

    const participants = select.users.map((u) => ({
      userId: u.id,
      username: u.username,
    }));
    addStepParticipants(stepId, participants);

    // Award rep to each participant
    for (const p of participants) {
      addReputation(p.userId, guild.id, p.username, REP_DUNGEON_CLEAR);
    }

    const steps = getSteps(challengeId);
    const clearedCount = steps.filter((s) => s.cleared).length;
    const allDone = clearedCount === steps.length;

    if (allDone) markChallengeCompleted(challengeId);

    // Refresh the sticky embed
    if (challenge.message_id) {
      try {
        const channel = await client.channels.fetch(challenge.channel_id);
        if (channel && channel.isTextBased()) {
          const msg = await (channel as TextChannel).messages.fetch(
            challenge.message_id
          );
          const { embed, row } = buildChallengeEmbed(challengeId);
          await msg.edit({ embeds: [embed], components: [row] });
        }
      } catch (err) {
        console.error("❌ Failed to refresh challenge embed:", err);
      }
    }

    const participantMentions = participants.map((p) => `<@${p.userId}>`).join(", ");
    await select.update({
      content:
        `✅ **${step.name}** marked as cleared!\n` +
        `**Participants:** ${participantMentions}\n` +
        `Each earned **+${REP_DUNGEON_CLEAR} reputation**!` +
        (allDone ? "\n\n🎉 **All steps complete — Challenge finished!**" : ""),
      components: [],
    });

    if (allDone) {
      try {
        const channel = await client.channels.fetch(challenge.channel_id);
        if (channel && channel.isTextBased()) {
          const celebEmbed = new EmbedBuilder()
            .setColor(0x57f287)
            .setTitle("🎉 World Challenge Complete!")
            .setDescription(
              `The server has conquered **${challenge.name}**! Every step has been cleared.\n\n` +
                `An incredible effort from all participants. Glory to the Grand Exchange! ⚔️`
            )
            .setTimestamp();
          await (channel as TextChannel).send({ embeds: [celebEmbed] });
        }
      } catch { /* not critical */ }
    }

    console.log(
      `✅ Step "${step.name}" cleared by ${select.user.tag} · ${participants.length} participants · rep +${REP_DUNGEON_CLEAR} each`
    );
    return;
  }

  // --- "Post a Quest" button → open modal directly ---
  if (interaction.isButton() && interaction.customId === "open_commission_modal") {
    const btn = interaction as ButtonInteraction;

    if (btn.channelId !== POST_A_QUEST_CHANNEL_ID) {
      await btn.reply({
        content: `❌ This can only be used in <#${POST_A_QUEST_CHANNEL_ID}>.`,
        flags: 1 << 6,
      });
      return;
    }

    const modal = new ModalBuilder()
      .setCustomId("commission_modal")
      .setTitle("Quest Request");

    const typeInput = new TextInputBuilder()
      .setCustomId("commission_type")
      .setLabel("What type of quest do you want to post?")
      .setStyle(TextInputStyle.Short)
      .setPlaceholder("e.g. Blacksmithing, Gathering, Leatherworking, Mercenary...")
      .setRequired(true)
      .setMaxLength(100);

    const descriptionInput = new TextInputBuilder()
      .setCustomId("description")
      .setLabel("Describe what you want in detail")
      .setStyle(TextInputStyle.Paragraph)
      .setPlaceholder("Describe your quest in as much detail as possible...")
      .setRequired(true)
      .setMaxLength(1000);

    const budgetInput = new TextInputBuilder()
      .setCustomId("budget")
      .setLabel("What is your budget?")
      .setStyle(TextInputStyle.Short)
      .setPlaceholder("e.g. 100 gold, 1000 gold, other item, etc.")
      .setRequired(true)
      .setMaxLength(100);

    const deadlineInput = new TextInputBuilder()
      .setCustomId("deadline")
      .setLabel("What is your deadline / timeline?")
      .setStyle(TextInputStyle.Short)
      .setPlaceholder("e.g. 1 week, by March 10th, no rush...")
      .setRequired(true)
      .setMaxLength(100);

    modal.addComponents(
      new ActionRowBuilder<TextInputBuilder>().addComponents(typeInput),
      new ActionRowBuilder<TextInputBuilder>().addComponents(descriptionInput),
      new ActionRowBuilder<TextInputBuilder>().addComponents(budgetInput),
      new ActionRowBuilder<TextInputBuilder>().addComponents(deadlineInput),
    );

    await btn.showModal(modal);
    return;
  }

  // --- /commission slash command → show modal ---
  if (interaction.isChatInputCommand() && interaction.commandName === "commission") {
    const cmd = interaction as ChatInputCommandInteraction;

    if (cmd.channelId !== POST_A_QUEST_CHANNEL_ID) {
      await cmd.reply({
        content: `❌ This command can only be used in <#${POST_A_QUEST_CHANNEL_ID}>.`,
        flags: 1 << 6,
      });
      return;
    }

    const modal = new ModalBuilder()
      .setCustomId("commission_modal")
      .setTitle("Quest Request");

    const typeInput = new TextInputBuilder()
      .setCustomId("commission_type")
      .setLabel("What type of quest do you want to post?")
      .setStyle(TextInputStyle.Short)
      .setPlaceholder("e.g. Blacksmithing, Gathering, Leatherworking, Mercenary...")
      .setRequired(true)
      .setMaxLength(100);

    const descriptionInput = new TextInputBuilder()
      .setCustomId("description")
      .setLabel("Describe what you want in detail")
      .setStyle(TextInputStyle.Paragraph)
      .setPlaceholder("Describe your quest in as much detail as possible...")
      .setRequired(true)
      .setMaxLength(1000);

    const budgetInput = new TextInputBuilder()
      .setCustomId("budget")
      .setLabel("What is your budget?")
      .setStyle(TextInputStyle.Short)
      .setPlaceholder("e.g. 100 gold, 1000 gold, other item, etc.")
      .setRequired(true)
      .setMaxLength(100);

    const deadlineInput = new TextInputBuilder()
      .setCustomId("deadline")
      .setLabel("What is your deadline / timeline?")
      .setStyle(TextInputStyle.Short)
      .setPlaceholder("e.g. 1 week, by March 10th, no rush...")
      .setRequired(true)
      .setMaxLength(100);

    modal.addComponents(
      new ActionRowBuilder<TextInputBuilder>().addComponents(typeInput),
      new ActionRowBuilder<TextInputBuilder>().addComponents(descriptionInput),
      new ActionRowBuilder<TextInputBuilder>().addComponents(budgetInput),
      new ActionRowBuilder<TextInputBuilder>().addComponents(deadlineInput),
    );

    await cmd.showModal(modal);
    return;
  }

  // --- Modal submission → ask for profession requirement ---
  if (interaction.isModalSubmit() && interaction.customId === "commission_modal") {
    const modal = interaction as ModalSubmitInteraction;

    // Store form data temporarily
    pendingForms.set(modal.user.id, {
      commissionType: modal.fields.getTextInputValue("commission_type"),
      description: modal.fields.getTextInputValue("description"),
      budget: modal.fields.getTextInputValue("budget"),
      deadline: modal.fields.getTextInputValue("deadline"),
    });

    // Ask for profession requirement using Discord's native role selector
    const roleSelect = new RoleSelectMenuBuilder()
      .setCustomId(`profession_select_${modal.user.id}`)
      .setPlaceholder("Search and select a required profession...")
      .setMinValues(0)
      .setMaxValues(1);

    const skipButton = new ButtonBuilder()
      .setCustomId(`profession_skip_${modal.user.id}`)
      .setLabel("No specific profession required")
      .setStyle(ButtonStyle.Secondary);

    await modal.reply({
      content:
        "**Almost done!** Does this quest require a specific profession?\n" +
        "Pick one from the list below, or skip if anyone can take it.",
      components: [
        new ActionRowBuilder<RoleSelectMenuBuilder>().addComponents(roleSelect),
        new ActionRowBuilder<ButtonBuilder>().addComponents(skipButton),
      ],
      flags: 1 << 6,
    });
    return;
  }

  // --- Profession role selected ---
  if (
    interaction.isRoleSelectMenu() &&
    interaction.customId.startsWith("profession_select_")
  ) {
    const select = interaction as RoleSelectMenuInteraction;
    const userId = select.customId.replace("profession_select_", "");

    if (select.user.id !== userId) return; // safety check

    const form = pendingForms.get(userId);
    if (!form) {
      await select.reply({ content: "❌ Session expired. Please run `/commission` again.", flags: 1 << 6 });
      return;
    }
    pendingForms.delete(userId);

    await select.deferUpdate();

    const selectedRole = select.values.length > 0
      ? (select.roles.get(select.values[0]) as Role | undefined) ?? null
      : null;

    const threadId = await createQuestThread(
      userId,
      select.user.username,
      select.user.displayAvatarURL(),
      form,
      selectedRole
    );

    if (threadId) {
      await select.editReply({
        content: `✅ Your quest has been posted! Check it out here: <#${threadId}>`,
        components: [],
      });
    } else {
      await select.editReply({
        content: "❌ Something went wrong while creating your quest thread. Please try again.",
        components: [],
      });
    }
    return;
  }

  // --- Profession skip button ---
  if (
    interaction.isButton() &&
    interaction.customId.startsWith("profession_skip_")
  ) {
    const btn = interaction as ButtonInteraction;
    const userId = btn.customId.replace("profession_skip_", "");

    if (btn.user.id !== userId) return; // safety check

    const form = pendingForms.get(userId);
    if (!form) {
      await btn.reply({ content: "❌ Session expired. Please run `/commission` again.", flags: 1 << 6 });
      return;
    }
    pendingForms.delete(userId);

    await btn.deferUpdate();

    const threadId = await createQuestThread(
      userId,
      btn.user.username,
      btn.user.displayAvatarURL(),
      form,
      null
    );

    if (threadId) {
      await btn.editReply({
        content: `✅ Your quest has been posted! Check it out here: <#${threadId}>`,
        components: [],
      });
    } else {
      await btn.editReply({
        content: "❌ Something went wrong while creating your quest thread. Please try again.",
        components: [],
      });
    }
    return;
  }

  // --- Accept Quest button ---
  if (interaction.isButton() && interaction.customId.startsWith("accept_commission_")) {
    const btn = interaction as ButtonInteraction;
    const thread = interaction.channel as ThreadChannel;
    const guild = interaction.guild;
    if (!guild) return;

    const requesterId = btn.customId.replace("accept_commission_", "");
    const acceptorId = btn.user.id;

    if (requesterId === acceptorId) {
      await btn.reply({ content: "❌ You cannot accept your own quest.", flags: 1 << 6 });
      return;
    }

    const disabledButton = new ButtonBuilder()
      .setCustomId("accepted_disabled")
      .setLabel("✅ Accepted")
      .setStyle(ButtonStyle.Success)
      .setDisabled(true);

    await btn.update({ components: [new ActionRowBuilder<ButtonBuilder>().addComponents(disabledButton)] });

    // Fetch requester's username for the channel name
    let requesterName = requesterId;
    try {
      const requesterMember = await guild.members.fetch(requesterId);
      requesterName = requesterMember.user.username;
    } catch { /* fallback to id */ }

    const privateChannel = await createPrivateCommissionChannel(
      guild,
      requesterId,
      acceptorId,
      thread.id,
      requesterName,
      btn.user.username
    );

    scheduleDeletion(thread, requesterId, privateChannel?.id ?? null);

    const deleteAt = Math.floor((Date.now() + DELETE_AFTER_MS) / 1000);

    const reopenButton = new ButtonBuilder()
      .setCustomId(`reopen_quest_${requesterId}`)
      .setLabel("🔄 Reopen Quest")
      .setStyle(ButtonStyle.Secondary);

    const acceptedEmbed = new EmbedBuilder()
      .setColor(0x57f287)
      .setTitle("✅ Quest Accepted")
      .setDescription(
        `This quest has been accepted by <@${acceptorId}>.\n` +
          `A private channel has been created for <@${requesterId}> and <@${acceptorId}>.\n\n` +
          `⚠️ This thread will be **automatically deleted** <t:${deleteAt}:R>.\n` +
          `Only <@${requesterId}> can reopen it before then.`
      )
      .setTimestamp();

    await btn.followUp({
      embeds: [acceptedEmbed],
      components: [new ActionRowBuilder<ButtonBuilder>().addComponents(reopenButton)],
    });

    if (privateChannel) {
      await btn.followUp({
        content: `📬 <@${requesterId}> <@${acceptorId}> — your private channel is ready: <#${privateChannel.id}>`,
      });
    }

    try {
      if (!thread.name.startsWith("[ACCEPTED]")) {
        await thread.setName(`[ACCEPTED] ${thread.name}`.slice(0, 100));
      }
    } catch { /* not critical */ }

    // Award reputation to the acceptor
    addReputation(acceptorId, guild.id, btn.user.username, REP_QUEST_ACCEPT);
    console.log(`⭐ +${REP_QUEST_ACCEPT} rep awarded to ${btn.user.tag}`);
    console.log(`✅ Quest accepted by ${btn.user.tag} in thread "${thread.name}"`);
    return;
  }

  // --- Complete Quest button → close private channel, mark thread complete ---
  if (interaction.isButton() && interaction.customId.startsWith("complete_quest_")) {
    const btn = interaction as ButtonInteraction;
    const guild = btn.guild;
    if (!guild) return;

    // Custom ID format: complete_quest_${requesterId}_${acceptorId}_${threadId}
    const parts = btn.customId.split("_");
    // parts: ["complete", "quest", requesterId, acceptorId, threadId]
    const requesterId = parts[2]!;
    const acceptorId  = parts[3]!;
    const threadId    = parts[4]!;

    if (btn.user.id !== requesterId) {
      await btn.reply({
        content: "❌ Only the person who posted this quest can mark it as complete.",
        flags: 1 << 6,
      });
      return;
    }

    // Disable the button immediately so it can't be double-clicked
    const disabledComplete = new ButtonBuilder()
      .setCustomId("complete_disabled")
      .setLabel("✅ Quest Completed")
      .setStyle(ButtonStyle.Success)
      .setDisabled(true);

    await btn.update({
      components: [new ActionRowBuilder<ButtonBuilder>().addComponents(disabledComplete)],
    });

    // Cancel the 24h auto-delete timer for the forum thread
    const pending = pendingDeletions.get(threadId);
    if (pending) {
      clearTimeout(pending.timeout);
      pendingDeletions.delete(threadId);
    }
    cancelPendingDeletion(threadId);

    // Mark the forum thread as [COMPLETE] and post a closing message
    try {
      const thread = await guild.channels.fetch(threadId) as ThreadChannel | null;
      if (thread) {
        const completionEmbed = new EmbedBuilder()
          .setColor(0x57f287)
          .setTitle("🏆 Quest Completed!")
          .setDescription(
            `This quest has been successfully completed!\n\n` +
              `**Requester:** <@${requesterId}>\n` +
              `**Completed by:** <@${acceptorId}>\n\n` +
              `Thank you for using the Grand Exchange. ⚔️`
          )
          .setTimestamp();

        await thread.send({ embeds: [completionEmbed] });

        if (!thread.name.startsWith("[COMPLETE]")) {
          const cleanName = thread.name.replace("[ACCEPTED] ", "");
          await thread.setName(`[COMPLETE] ${cleanName}`.slice(0, 100));
        }
        await thread.setArchived(true).catch(() => {});
      }
    } catch (err) {
      console.error("❌ Failed to update forum thread on completion:", err);
    }

    // Post a goodbye message in the private channel then delete it after 10s
    await btn.followUp({
      content:
        `✅ Quest marked as complete by <@${btn.user.id}>!\n` +
        `This channel will be deleted in **10 seconds**.`,
    });

    setTimeout(async () => {
      try {
        const privateChannel = await guild.channels.fetch(btn.channelId);
        if (privateChannel) await privateChannel.delete("Quest completed");
      } catch { /* already gone */ }
    }, 10_000);

    console.log(
      `🏆 Quest completed by ${btn.user.tag} — thread ${threadId} archived, channel closing`
    );
    return;
  }

  // --- Reopen Quest button ---
  if (interaction.isButton() && interaction.customId.startsWith("reopen_quest_")) {
    const btn = interaction as ButtonInteraction;
    const thread = interaction.channel as ThreadChannel;
    const guild = interaction.guild;
    if (!guild) return;

    const requesterId = btn.customId.replace("reopen_quest_", "");

    // Block reopen if the quest was already completed
    if (thread.name.startsWith("[COMPLETE]")) {
      await btn.reply({
        content: "❌ This quest has already been completed and cannot be reopened.",
        flags: 1 << 6,
      });
      return;
    }

    if (btn.user.id !== requesterId) {
      await btn.reply({
        content: "❌ Only the person who posted this quest can reopen it.",
        flags: 1 << 6,
      });
      return;
    }

    const pending = pendingDeletions.get(thread.id);
    cancelPendingDeletion(thread.id);
    if (pending) {
      clearTimeout(pending.timeout);
      pendingDeletions.delete(thread.id);

      if (pending.privateChannelId) {
        try {
          const privateChannel = await guild.channels.fetch(pending.privateChannelId);
          if (privateChannel) await privateChannel.delete("Quest reopened by requester");
        } catch { /* already deleted */ }
      }
    }

    try {
      if (thread.name.startsWith("[ACCEPTED] ")) {
        await thread.setName(thread.name.replace("[ACCEPTED] ", "").slice(0, 100));
      }
    } catch { /* not critical */ }

    try {
      await btn.update({
        embeds: [
          new EmbedBuilder()
            .setColor(0xfee75c)
            .setTitle("🔄 Quest Reopened")
            .setDescription(
              `<@${requesterId}> has reopened this quest. It is available to accept again.`
            )
            .setTimestamp(),
        ],
        components: [],
      });
    } catch {
      await btn.reply({ content: "🔄 Quest reopened.", flags: 1 << 6 });
    }

    const freshAcceptButton = new ButtonBuilder()
      .setCustomId(`accept_commission_${requesterId}`)
      .setLabel("✅ Accept Quest")
      .setStyle(ButtonStyle.Success);

    await btn.followUp({
      content: `🔄 This quest is open again!`,
      components: [new ActionRowBuilder<ButtonBuilder>().addComponents(freshAcceptButton)],
    });

    console.log(`🔄 Quest reopened by ${btn.user.tag} in thread "${thread.name}"`);
    return;
  }
});

// ---------------------------------------------------------------------------
// Reaction role handlers
// ---------------------------------------------------------------------------
client.on(Events.MessageReactionAdd, async (reaction, user) => {
  if (user.bot) return;

  try {
    if (reaction.partial) await reaction.fetch();
    if (reaction.message.partial) await reaction.message.fetch();
  } catch {
    return;
  }

  const guild = reaction.message.guild;
  if (!guild) return;

  // Identify the skill this message belongs to
  const skillName = getSkillByMessage(reaction.message.id, guild.id);
  if (!skillName) return;

  const skill = SKILLS.find((s) => s.name === skillName);
  if (!skill) return;

  // Match the reaction emoji against this skill's tier emojis
  const emojiKey = reactionEmojiKey(reaction.emoji);
  const tierEmojis = getTierEmojis(skill);
  const tierIndex = (tierEmojis as string[]).indexOf(emojiKey);
  if (tierIndex === -1) return;

  let member: import("discord.js").GuildMember;
  try {
    member = await guild.members.fetch(user.id);
  } catch {
    return;
  }

  const chosenRole = guild.roles.cache.find((r) => r.name === skill.roles[tierIndex]);
  if (chosenRole) {
    await member.roles.add(chosenRole).catch(console.error);
  }

  console.log(`🎭 Assigned "${skill.roles[tierIndex]}" to ${user.tag}`);
});

client.on(Events.MessageReactionRemove, async (reaction, user) => {
  if (user.bot) return;

  // Small delay to let any in-flight ReactionAdd finish first.
  // Without this a quick double-click races: remove fires before add
  // completes, finds no role yet, exits — then add finishes and role sticks.
  await new Promise((res) => setTimeout(res, 600));

  try {
    if (reaction.partial) await reaction.fetch();
    if (reaction.message.partial) await reaction.message.fetch();
  } catch {
    return;
  }

  const guild = reaction.message.guild;
  if (!guild) return;

  // Identify the skill this message belongs to
  const skillName = getSkillByMessage(reaction.message.id, guild.id);
  if (!skillName) return;

  const skill = SKILLS.find((s) => s.name === skillName);
  if (!skill) return;

  // Match the reaction emoji against this skill's tier emojis
  const emojiKey = reactionEmojiKey(reaction.emoji);
  const tierEmojis = getTierEmojis(skill);
  const tierIndex = (tierEmojis as string[]).indexOf(emojiKey);
  if (tierIndex === -1) return;

  let member: import("discord.js").GuildMember;
  try {
    member = await guild.members.fetch(user.id);
  } catch {
    return;
  }

  const role = guild.roles.cache.find((r) => r.name === skill.roles[tierIndex]);
  if (role && member.roles.cache.has(role.id)) {
    await member.roles.remove(role).catch(console.error);
    console.log(`🎭 Removed "${skill.roles[tierIndex]}" from ${user.tag}`);
  }
});

// ---------------------------------------------------------------------------
// Health-check HTTP server — keeps the process alive and lets Replit verify
// the service is running. Responds 200 OK to any request.
// ---------------------------------------------------------------------------
import { createServer as createHttpServer } from "http";
const _healthPort = parseInt(process.env.PORT ?? "3000", 10);
createHttpServer((_req, res) => {
  res.writeHead(200, { "Content-Type": "text/plain" });
  res.end("OK");
}).listen(_healthPort, () => {
  console.log(`🏥 Health server listening on port ${_healthPort}`);
});

client.login(DISCORD_BOT_TOKEN);
