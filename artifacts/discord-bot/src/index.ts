import {
  Client,
  GatewayIntentBits,
  Events,
  Message,
  EmbedBuilder,
  ButtonBuilder,
  ButtonStyle,
  ActionRowBuilder,
  ChannelType,
  ForumChannel,
  ButtonInteraction,
  ThreadChannel,
  Partials,
} from "discord.js";

const DISCORD_BOT_TOKEN = process.env["DISCORD_BOT_TOKEN"];
const FORUM_CHANNEL_ID = process.env["FORUM_CHANNEL_ID"];
const TICKET_SOURCE_CHANNEL_ID = process.env["TICKET_SOURCE_CHANNEL_ID"];

if (!DISCORD_BOT_TOKEN) throw new Error("DISCORD_BOT_TOKEN is required");
if (!FORUM_CHANNEL_ID) throw new Error("FORUM_CHANNEL_ID is required");
if (!TICKET_SOURCE_CHANNEL_ID)
  throw new Error("TICKET_SOURCE_CHANNEL_ID is required");

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
  ],
  partials: [Partials.Message, Partials.Channel],
});

client.once(Events.ClientReady, (readyClient) => {
  console.log(`✅ Bot ready! Logged in as ${readyClient.user.tag}`);
  console.log(`📋 Watching channel: ${TICKET_SOURCE_CHANNEL_ID}`);
  console.log(`🗂️  Forum channel: ${FORUM_CHANNEL_ID}`);
});

/**
 * Parse a Ticket Tool embed to extract the user's submitted answers.
 * Ticket Tool posts embeds where each field has a question (name) and answer (value).
 */
function parseTicketEmbed(message: Message): {
  title: string;
  fields: { question: string; answer: string }[];
  ticketOwner: string;
  ticketNumber: string | null;
} | null {
  if (!message.embeds || message.embeds.length === 0) return null;

  const embed = message.embeds[0];

  // Ticket Tool embeds typically have fields with Q&A pairs
  if (!embed.fields || embed.fields.length === 0) return null;

  const fields = embed.fields.map((f) => ({
    question: f.name,
    answer: f.value || "*(no answer)*",
  }));

  // Try to get ticket submitter from embed footer or author
  const ticketOwner =
    embed.author?.name ||
    embed.footer?.text ||
    message.author?.username ||
    "Unknown";

  // Try to extract ticket number from title or description
  const rawTitle = embed.title || embed.description || "";
  const ticketNumberMatch = rawTitle.match(/#(\d+)/);
  const ticketNumber = ticketNumberMatch ? ticketNumberMatch[1] : null;

  const title = embed.title || "New Commission Request";

  return { title, fields, ticketOwner, ticketNumber };
}

/**
 * Create a forum thread for the commission request.
 */
async function createCommissionThread(
  message: Message,
  parsed: ReturnType<typeof parseTicketEmbed>
): Promise<void> {
  if (!parsed) return;

  const forumChannel = await client.channels.fetch(FORUM_CHANNEL_ID!);
  if (!forumChannel || forumChannel.type !== ChannelType.GuildForum) {
    console.error(
      `❌ Channel ${FORUM_CHANNEL_ID} is not a forum channel or doesn't exist.`
    );
    return;
  }

  const forum = forumChannel as ForumChannel;

  // Build thread title
  const threadTitle = parsed.ticketNumber
    ? `Commission #${parsed.ticketNumber} — ${parsed.ticketOwner}`
    : `Commission Request — ${parsed.ticketOwner}`;

  // Build the embed for the forum post
  const embed = new EmbedBuilder()
    .setColor(0x5865f2)
    .setTitle("📋 Commission Request")
    .setAuthor({ name: parsed.ticketOwner })
    .setTimestamp(message.createdAt)
    .setFooter({ text: "Click Accept below to take this commission" });

  if (parsed.ticketNumber) {
    embed.setDescription(`**Ticket:** #${parsed.ticketNumber}`);
  }

  // Add each Q&A as a field
  for (const field of parsed.fields) {
    embed.addFields({
      name: field.question,
      value: field.answer.slice(0, 1024), // Discord field value limit
      inline: false,
    });
  }

  // Add a link back to the original ticket message
  embed.addFields({
    name: "Original Ticket",
    value: `[Jump to ticket](${message.url})`,
    inline: false,
  });

  // Accept button
  const acceptButton = new ButtonBuilder()
    .setCustomId(`accept_commission_${message.id}`)
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
    `✅ Created forum thread: "${threadTitle}" (${thread.id}) for ticket from ${parsed.ticketOwner}`
  );

  // React to the original ticket message to confirm it was picked up
  try {
    await message.react("✅");
  } catch {
    // Reaction might fail due to permissions, not critical
  }
}

/**
 * Handle the Accept Commission button press.
 */
async function handleAcceptButton(interaction: ButtonInteraction): Promise<void> {
  const thread = interaction.channel as ThreadChannel;

  // Update the embed to show accepted status
  const acceptedEmbed = new EmbedBuilder()
    .setColor(0x57f287)
    .setTitle("✅ Commission Accepted")
    .setDescription(
      `This commission has been accepted by <@${interaction.user.id}>.`
    )
    .setTimestamp();

  // Disable the button after acceptance
  const disabledButton = new ButtonBuilder()
    .setCustomId("accepted_disabled")
    .setLabel("✅ Accepted")
    .setStyle(ButtonStyle.Success)
    .setDisabled(true);

  const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
    disabledButton
  );

  await interaction.update({ components: [row] });

  // Post a follow-up message in the thread
  await interaction.followUp({
    embeds: [acceptedEmbed],
  });

  // Rename the thread to mark it as accepted
  try {
    if (thread && thread.setName) {
      const currentName = thread.name;
      if (!currentName.startsWith("[ACCEPTED]")) {
        await thread.setName(`[ACCEPTED] ${currentName}`.slice(0, 100));
      }
    }
  } catch {
    // Thread rename might fail due to permissions, not critical
  }

  console.log(
    `✅ Commission accepted by ${interaction.user.tag} in thread ${thread?.name}`
  );
}

// Listen for new messages in the ticket source channel
client.on(Events.MessageCreate, async (message: Message) => {
  // Only watch the configured ticket channel
  if (message.channelId !== TICKET_SOURCE_CHANNEL_ID) return;

  // Ignore messages from our own bot
  if (message.author.id === client.user?.id) return;

  console.log(
    `📨 New message in ticket channel from ${message.author.username} (${message.author.id})`
  );
  console.log(
    `   Embeds: ${message.embeds.length}, Attachments: ${message.attachments.size}`
  );

  const parsed = parseTicketEmbed(message);
  if (!parsed) {
    console.log(
      "   ℹ️ Message has no ticket embed fields, skipping forum thread creation."
    );
    return;
  }

  console.log(
    `   📋 Parsed ticket: "${parsed.title}" with ${parsed.fields.length} fields`
  );

  try {
    await createCommissionThread(message, parsed);
  } catch (err) {
    console.error("❌ Failed to create forum thread:", err);
  }
});

// Handle button interactions
client.on(Events.InteractionCreate, async (interaction) => {
  if (!interaction.isButton()) return;

  if (interaction.customId.startsWith("accept_commission_")) {
    try {
      await handleAcceptButton(interaction as ButtonInteraction);
    } catch (err) {
      console.error("❌ Failed to handle accept button:", err);
      try {
        await interaction.reply({
          content: "❌ Something went wrong. Please try again.",
          ephemeral: true,
        });
      } catch {
        // ignore
      }
    }
  }
});

client.login(DISCORD_BOT_TOKEN);
