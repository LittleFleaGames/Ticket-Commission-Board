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
} from "discord.js";

const DISCORD_BOT_TOKEN = process.env["DISCORD_BOT_TOKEN"];
const FORUM_CHANNEL_ID = process.env["FORUM_CHANNEL_ID"];
const POST_A_QUEST_CHANNEL_ID = "1486847104457638009";
const COMMISSION_CATEGORY_ID = "1486848687706738889";
const DELETE_AFTER_MS = 24 * 60 * 60 * 1000; // 24 hours

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
  intents: [GatewayIntentBits.Guilds],
  partials: [Partials.Channel],
});

// ---------------------------------------------------------------------------
// Slash command definition
// ---------------------------------------------------------------------------
const commissionCommand = new SlashCommandBuilder()
  .setName("commission")
  .setDescription("Post a quest request — a forum thread will be created for you");

// ---------------------------------------------------------------------------
// Register slash commands for all guilds the bot is in
// ---------------------------------------------------------------------------
async function registerCommands(guildId: string): Promise<void> {
  const rest = new REST({ version: "10" }).setToken(DISCORD_BOT_TOKEN!);
  const appId = client.application?.id;
  if (!appId) return;

  try {
    await rest.put(Routes.applicationGuildCommands(appId, guildId), {
      body: [commissionCommand.toJSON()],
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
});

client.on(Events.GuildCreate, async (guild) => {
  console.log(`📥 Joined new guild: ${guild.name}`);
  await registerCommands(guild.id);
});

// ---------------------------------------------------------------------------
// Create a private text channel between requester, acceptor, and admins
// ---------------------------------------------------------------------------
async function createPrivateCommissionChannel(
  guild: Guild,
  requesterId: string,
  acceptorId: string,
  threadId: string
): Promise<TextChannel | null> {
  try {
    const botId = client.user!.id;
    const adminRoles = guild.roles.cache.filter((role) =>
      role.permissions.has(PermissionFlagsBits.Administrator)
    );

    const channel = await guild.channels.create({
      name: `quest-${requesterId}-${acceptorId}`.slice(0, 100),
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
          `You can discuss the details of the quest here. Original quest thread: <#${threadId}>`
      )
      .setTimestamp();

    await channel.send({ embeds: [welcomeEmbed] });
    console.log(`✅ Created private channel: ${channel.name} (${channel.id})`);
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
  privateChannelId: string | null
): void {
  const existing = pendingDeletions.get(thread.id);
  if (existing) clearTimeout(existing.timeout);

  const timeout = setTimeout(async () => {
    try {
      pendingDeletions.delete(thread.id);
      await thread.delete("Auto-deleted 24 hours after quest acceptance");
      console.log(`🗑️ Auto-deleted thread: ${thread.id}`);
    } catch (err) {
      console.error(`❌ Failed to auto-delete thread ${thread.id}:`, err);
    }
  }, DELETE_AFTER_MS);

  pendingDeletions.set(thread.id, { timeout, requesterId, privateChannelId });
  console.log(`⏳ Thread ${thread.id} scheduled for deletion in 24h`);
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

    const privateChannel = await createPrivateCommissionChannel(
      guild,
      requesterId,
      acceptorId,
      thread.id
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

    console.log(`✅ Quest accepted by ${btn.user.tag} in thread "${thread.name}"`);
    return;
  }

  // --- Reopen Quest button ---
  if (interaction.isButton() && interaction.customId.startsWith("reopen_quest_")) {
    const btn = interaction as ButtonInteraction;
    const thread = interaction.channel as ThreadChannel;
    const guild = interaction.guild;
    if (!guild) return;

    const requesterId = btn.customId.replace("reopen_quest_", "");

    if (btn.user.id !== requesterId) {
      await btn.reply({
        content: "❌ Only the person who posted this quest can reopen it.",
        flags: 1 << 6,
      });
      return;
    }

    const pending = pendingDeletions.get(thread.id);
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

client.login(DISCORD_BOT_TOKEN);
