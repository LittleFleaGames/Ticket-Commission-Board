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
} from "discord.js";

const DISCORD_BOT_TOKEN = process.env["DISCORD_BOT_TOKEN"];
const FORUM_CHANNEL_ID = process.env["FORUM_CHANNEL_ID"];
const POST_A_QUEST_CHANNEL_ID = "1486847104457638009";
const COMMISSION_CATEGORY_ID = "1486848687706738889";
const DELETE_AFTER_MS = 24 * 60 * 60 * 1000; // 24 hours

if (!DISCORD_BOT_TOKEN) throw new Error("DISCORD_BOT_TOKEN is required");
if (!FORUM_CHANNEL_ID) throw new Error("FORUM_CHANNEL_ID is required");

// ---------------------------------------------------------------------------
// In-memory store for pending deletions (survives until bot restart)
// ---------------------------------------------------------------------------
interface PendingDeletion {
  timeout: ReturnType<typeof setTimeout>;
  requesterId: string;
  privateChannelId: string | null;
}
const pendingDeletions = new Map<string, PendingDeletion>(); // threadId → data

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
  // Clear any existing timer for this thread
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

    const extrasInput = new TextInputBuilder()
      .setCustomId("extras")
      .setLabel("Any references or extra info? (optional)")
      .setStyle(TextInputStyle.Paragraph)
      .setPlaceholder("Links, images, style references, special requirements...")
      .setRequired(false)
      .setMaxLength(800);

    modal.addComponents(
      new ActionRowBuilder<TextInputBuilder>().addComponents(typeInput),
      new ActionRowBuilder<TextInputBuilder>().addComponents(descriptionInput),
      new ActionRowBuilder<TextInputBuilder>().addComponents(budgetInput),
      new ActionRowBuilder<TextInputBuilder>().addComponents(deadlineInput),
      new ActionRowBuilder<TextInputBuilder>().addComponents(extrasInput),
    );

    await cmd.showModal(modal);
    return;
  }

  // --- Modal submission → create forum thread ---
  if (interaction.isModalSubmit() && interaction.customId === "commission_modal") {
    const modal = interaction as ModalSubmitInteraction;
    await modal.deferReply({ flags: 1 << 6 });

    const commissionType = modal.fields.getTextInputValue("commission_type");
    const description = modal.fields.getTextInputValue("description");
    const budget = modal.fields.getTextInputValue("budget");
    const deadline = modal.fields.getTextInputValue("deadline");
    const extras = modal.fields.getTextInputValue("extras") || null;

    try {
      const forumChannel = await client.channels.fetch(FORUM_CHANNEL_ID!);
      if (!forumChannel || forumChannel.type !== ChannelType.GuildForum) {
        await modal.editReply({
          content: "❌ The forum channel is not configured correctly. Please contact a server admin.",
        });
        return;
      }

      const forum = forumChannel as ForumChannel;
      const threadTitle = `[${commissionType}] — ${modal.user.username}`.slice(0, 100);

      const embed = new EmbedBuilder()
        .setColor(0x5865f2)
        .setTitle("📋 Quest Request")
        .setAuthor({
          name: modal.user.username,
          iconURL: modal.user.displayAvatarURL(),
        })
        .addFields(
          { name: "⚔️ Quest Type", value: commissionType, inline: true },
          { name: "💰 Budget", value: budget, inline: true },
          { name: "⏰ Deadline", value: deadline, inline: true },
          { name: "📝 Description", value: description, inline: false },
        )
        .setTimestamp()
        .setFooter({ text: "Click Accept below to take this quest" });

      if (extras) {
        embed.addFields({ name: "📎 References / Extra Info", value: extras, inline: false });
      }

      const acceptButton = new ButtonBuilder()
        .setCustomId(`accept_commission_${modal.user.id}`)
        .setLabel("✅ Accept Quest")
        .setStyle(ButtonStyle.Success);

      const row = new ActionRowBuilder<ButtonBuilder>().addComponents(acceptButton);

      const previewText =
        `**⚔️ Quest Type:** ${commissionType}\n` +
        `**📝 What's needed:** ${description}\n` +
        `**💰 Budget:** ${budget} · **⏰ Deadline:** ${deadline}`;

      const thread = await forum.threads.create({
        name: threadTitle,
        message: {
          content: previewText,
          embeds: [embed],
          components: [row],
        },
      });

      console.log(`✅ Created forum thread: "${threadTitle}" (${thread.id}) by ${modal.user.tag}`);

      await modal.editReply({
        content: `✅ Your quest has been posted! Check it out here: <#${thread.id}>`,
      });
    } catch (err) {
      console.error("❌ Failed to create forum thread:", err);
      await modal.editReply({
        content: "❌ Something went wrong while creating your quest thread. Please try again.",
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

    // Disable the Accept button
    const disabledButton = new ButtonBuilder()
      .setCustomId("accepted_disabled")
      .setLabel("✅ Accepted")
      .setStyle(ButtonStyle.Success)
      .setDisabled(true);

    await btn.update({ components: [new ActionRowBuilder<ButtonBuilder>().addComponents(disabledButton)] });

    // Create the private channel
    const privateChannel = await createPrivateCommissionChannel(
      guild,
      requesterId,
      acceptorId,
      thread.id
    );

    // Schedule thread deletion after 24 hours
    scheduleDeletion(thread, requesterId, privateChannel?.id ?? null);

    // Build the deletion timestamp for display
    const deleteAt = Math.floor((Date.now() + DELETE_AFTER_MS) / 1000);

    // Reopen button (only the requester can use it)
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

    // Rename thread
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

    // Only the original requester can reopen
    if (btn.user.id !== requesterId) {
      await btn.reply({
        content: "❌ Only the person who posted this quest can reopen it.",
        flags: 1 << 6,
      });
      return;
    }

    const pending = pendingDeletions.get(thread.id);

    // Cancel the deletion timer
    if (pending) {
      clearTimeout(pending.timeout);
      pendingDeletions.delete(thread.id);

      // Delete the private channel if it exists
      if (pending.privateChannelId) {
        try {
          const privateChannel = await guild.channels.fetch(pending.privateChannelId);
          if (privateChannel) await privateChannel.delete("Quest reopened by requester");
          console.log(`🗑️ Deleted private channel ${pending.privateChannelId}`);
        } catch { /* already deleted or no permission */ }
      }
    }

    // Remove [ACCEPTED] from thread name
    try {
      if (thread.name.startsWith("[ACCEPTED] ")) {
        await thread.setName(thread.name.replace("[ACCEPTED] ", "").slice(0, 100));
      }
    } catch { /* not critical */ }

    // Edit the accepted message to remove the reopen button
    try {
      await btn.update({
        embeds: [
          new EmbedBuilder()
            .setColor(0xfee75c)
            .setTitle("🔄 Quest Reopened")
            .setDescription(`<@${requesterId}> has reopened this quest. It is available to accept again.`)
            .setTimestamp(),
        ],
        components: [],
      });
    } catch {
      await btn.reply({ content: "🔄 Quest reopened.", flags: 1 << 6 });
    }

    // Post a fresh Accept button so others can take the quest again
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
