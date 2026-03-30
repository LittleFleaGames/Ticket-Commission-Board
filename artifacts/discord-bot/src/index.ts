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
  Partials,
  REST,
  Routes,
  SlashCommandBuilder,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  ModalSubmitInteraction,
  ChatInputCommandInteraction,
} from "discord.js";

const DISCORD_BOT_TOKEN = process.env["DISCORD_BOT_TOKEN"];
const FORUM_CHANNEL_ID = process.env["FORUM_CHANNEL_ID"];

if (!DISCORD_BOT_TOKEN) throw new Error("DISCORD_BOT_TOKEN is required");
if (!FORUM_CHANNEL_ID) throw new Error("FORUM_CHANNEL_ID is required");

const client = new Client({
  intents: [GatewayIntentBits.Guilds],
  partials: [Partials.Channel],
});

// ---------------------------------------------------------------------------
// Slash command definition
// ---------------------------------------------------------------------------
const commissionCommand = new SlashCommandBuilder()
  .setName("commission")
  .setDescription("Submit a commission request — a forum thread will be created for you");

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

  // Register commands for every guild the bot is already in
  for (const guild of readyClient.guilds.cache.values()) {
    await registerCommands(guild.id);
  }
});

// Also register when joining a new guild
client.on(Events.GuildCreate, async (guild) => {
  console.log(`📥 Joined new guild: ${guild.name}`);
  await registerCommands(guild.id);
});

// ---------------------------------------------------------------------------
// Handle /commission command → open modal
// ---------------------------------------------------------------------------
client.on(Events.InteractionCreate, async (interaction) => {
  // --- Slash command ---
  if (interaction.isChatInputCommand() && interaction.commandName === "commission") {
    const cmd = interaction as ChatInputCommandInteraction;

    const modal = new ModalBuilder()
      .setCustomId("commission_modal")
      .setTitle("Commission Request");

    const typeInput = new TextInputBuilder()
      .setCustomId("commission_type")
      .setLabel("What type of commission are you requesting?")
      .setStyle(TextInputStyle.Short)
      .setPlaceholder("e.g. Art, Writing, Music, Video editing...")
      .setRequired(true)
      .setMaxLength(100);

    const descriptionInput = new TextInputBuilder()
      .setCustomId("description")
      .setLabel("Describe what you want in detail")
      .setStyle(TextInputStyle.Paragraph)
      .setPlaceholder("Describe your commission in as much detail as possible...")
      .setRequired(true)
      .setMaxLength(1000);

    const budgetInput = new TextInputBuilder()
      .setCustomId("budget")
      .setLabel("What is your budget?")
      .setStyle(TextInputStyle.Short)
      .setPlaceholder("e.g. $20–$50, open to offers, etc.")
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

  // --- Modal submission ---
  if (interaction.isModalSubmit() && interaction.customId === "commission_modal") {
    const modal = interaction as ModalSubmitInteraction;
    await modal.deferReply({ ephemeral: true });

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

      // Build the embed
      const embed = new EmbedBuilder()
        .setColor(0x5865f2)
        .setTitle("📋 Commission Request")
        .setAuthor({
          name: modal.user.username,
          iconURL: modal.user.displayAvatarURL(),
        })
        .addFields(
          { name: "🎨 Type", value: commissionType, inline: true },
          { name: "💰 Budget", value: budget, inline: true },
          { name: "⏰ Deadline", value: deadline, inline: true },
          { name: "📝 Description", value: description, inline: false },
        )
        .setTimestamp()
        .setFooter({ text: "Click Accept below to take this commission" });

      if (extras) {
        embed.addFields({ name: "📎 References / Extra Info", value: extras, inline: false });
      }

      // Accept button
      const acceptButton = new ButtonBuilder()
        .setCustomId(`accept_commission_${modal.user.id}`)
        .setLabel("✅ Accept Commission")
        .setStyle(ButtonStyle.Success);

      const row = new ActionRowBuilder<ButtonBuilder>().addComponents(acceptButton);

      // Create the forum thread
      const thread = await forum.threads.create({
        name: threadTitle,
        message: {
          embeds: [embed],
          components: [row],
        },
      });

      console.log(
        `✅ Created forum thread: "${threadTitle}" (${thread.id}) by ${modal.user.tag}`
      );

      await modal.editReply({
        content: `✅ Your commission request has been posted! Check it out here: <#${thread.id}>`,
      });
    } catch (err) {
      console.error("❌ Failed to create forum thread:", err);
      await modal.editReply({
        content: "❌ Something went wrong while creating your forum thread. Please try again.",
      });
    }
    return;
  }

  // --- Accept Commission button ---
  if (interaction.isButton() && interaction.customId.startsWith("accept_commission_")) {
    const btn = interaction as ButtonInteraction;
    const thread = interaction.channel as ThreadChannel;

    // Disable the button
    const disabledButton = new ButtonBuilder()
      .setCustomId("accepted_disabled")
      .setLabel("✅ Accepted")
      .setStyle(ButtonStyle.Success)
      .setDisabled(true);

    const row = new ActionRowBuilder<ButtonBuilder>().addComponents(disabledButton);
    await btn.update({ components: [row] });

    // Post confirmation in thread
    const acceptedEmbed = new EmbedBuilder()
      .setColor(0x57f287)
      .setTitle("✅ Commission Accepted")
      .setDescription(`This commission has been accepted by <@${btn.user.id}>.`)
      .setTimestamp();

    await btn.followUp({ embeds: [acceptedEmbed] });

    // Rename thread
    try {
      if (thread?.setName && !thread.name.startsWith("[ACCEPTED]")) {
        await thread.setName(`[ACCEPTED] ${thread.name}`.slice(0, 100));
      }
    } catch {
      // Permission issue — not critical
    }

    console.log(`✅ Commission accepted by ${btn.user.tag} in thread "${thread?.name}"`);
    return;
  }
});

client.login(DISCORD_BOT_TOKEN);
