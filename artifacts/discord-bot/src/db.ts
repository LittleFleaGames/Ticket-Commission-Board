import pg from "pg";

const { Pool } = pg;

if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required");

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
  max: 5,
});

// ---------------------------------------------------------------------------
// Table initialisation (run once on startup)
// ---------------------------------------------------------------------------
export const dbReady: Promise<void> = (async () => {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS challenges (
      id            TEXT    PRIMARY KEY,
      guild_id      TEXT    NOT NULL,
      channel_id    TEXT    NOT NULL,
      message_id    TEXT,
      name          TEXT    NOT NULL,
      deadline_text TEXT    NOT NULL,
      deadline_ts   BIGINT  NOT NULL,
      completed     INTEGER DEFAULT 0,
      created_at    BIGINT  NOT NULL
    );

    CREATE TABLE IF NOT EXISTS challenge_steps (
      id              TEXT    PRIMARY KEY,
      challenge_id    TEXT    NOT NULL,
      name            TEXT    NOT NULL,
      position        INTEGER NOT NULL,
      cleared         INTEGER DEFAULT 0,
      cleared_at      BIGINT,
      cleared_by_id   TEXT,
      cleared_by_name TEXT
    );

    CREATE TABLE IF NOT EXISTS step_participants (
      step_id  TEXT NOT NULL,
      user_id  TEXT NOT NULL,
      username TEXT NOT NULL,
      PRIMARY KEY (step_id, user_id)
    );

    CREATE TABLE IF NOT EXISTS reputation (
      user_id  TEXT    NOT NULL,
      guild_id TEXT    NOT NULL,
      username TEXT    NOT NULL,
      points   INTEGER DEFAULT 0,
      PRIMARY KEY (user_id, guild_id)
    );

    CREATE TABLE IF NOT EXISTS role_messages (
      skill_name TEXT NOT NULL,
      guild_id   TEXT NOT NULL,
      channel_id TEXT NOT NULL,
      message_id TEXT NOT NULL,
      PRIMARY KEY (skill_name, guild_id)
    );

    CREATE TABLE IF NOT EXISTS pending_deletions (
      thread_id          TEXT   PRIMARY KEY,
      guild_id           TEXT   NOT NULL,
      requester_id       TEXT   NOT NULL,
      private_channel_id TEXT,
      delete_at          BIGINT NOT NULL
    );
  `);
  console.log("✅ Database tables initialised");
})();

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface Challenge {
  id: string;
  guild_id: string;
  channel_id: string;
  message_id: string | null;
  name: string;
  deadline_text: string;
  deadline_ts: number;
  completed: number;
  created_at: number;
}

export interface ChallengeStep {
  id: string;
  challenge_id: string;
  name: string;
  position: number;
  cleared: number;
  cleared_at: number | null;
  cleared_by_id: string | null;
  cleared_by_name: string | null;
}

export interface StepParticipant {
  step_id: string;
  user_id: string;
  username: string;
}

export interface Reputation {
  user_id: string;
  guild_id: string;
  username: string;
  points: number;
}

// ---------------------------------------------------------------------------
// Challenge helpers
// ---------------------------------------------------------------------------

export async function createChallenge(
  id: string,
  guildId: string,
  channelId: string,
  name: string,
  deadlineText: string,
  deadlineTs: number
): Promise<void> {
  await pool.query(
    `INSERT INTO challenges (id, guild_id, channel_id, name, deadline_text, deadline_ts, created_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [id, guildId, channelId, name, deadlineText, deadlineTs, Date.now()]
  );
}

export async function getChallengeByChannel(channelId: string): Promise<Challenge | undefined> {
  const { rows } = await pool.query<Challenge>(
    "SELECT * FROM challenges WHERE channel_id = $1",
    [channelId]
  );
  return rows[0];
}

export async function getChallengeById(id: string): Promise<Challenge | undefined> {
  const { rows } = await pool.query<Challenge>(
    "SELECT * FROM challenges WHERE id = $1",
    [id]
  );
  return rows[0];
}

export async function updateChallengeMessageId(challengeId: string, messageId: string): Promise<void> {
  await pool.query(
    "UPDATE challenges SET message_id = $1 WHERE id = $2",
    [messageId, challengeId]
  );
}

export async function markChallengeCompleted(challengeId: string): Promise<void> {
  await pool.query(
    "UPDATE challenges SET completed = 1 WHERE id = $1",
    [challengeId]
  );
}

export async function getAllActiveChallenges(): Promise<Challenge[]> {
  const { rows } = await pool.query<Challenge>(
    "SELECT * FROM challenges WHERE completed = 0"
  );
  return rows;
}

// ---------------------------------------------------------------------------
// Step helpers
// ---------------------------------------------------------------------------

export async function createStep(
  id: string,
  challengeId: string,
  name: string,
  position: number
): Promise<void> {
  await pool.query(
    `INSERT INTO challenge_steps (id, challenge_id, name, position) VALUES ($1, $2, $3, $4)`,
    [id, challengeId, name, position]
  );
}

export async function getSteps(challengeId: string): Promise<ChallengeStep[]> {
  const { rows } = await pool.query<ChallengeStep>(
    "SELECT * FROM challenge_steps WHERE challenge_id = $1 ORDER BY position",
    [challengeId]
  );
  return rows;
}

export async function getStepById(stepId: string): Promise<ChallengeStep | undefined> {
  const { rows } = await pool.query<ChallengeStep>(
    "SELECT * FROM challenge_steps WHERE id = $1",
    [stepId]
  );
  return rows[0];
}

export async function clearStep(
  stepId: string,
  clearedById: string,
  clearedByName: string
): Promise<void> {
  await pool.query(
    `UPDATE challenge_steps
     SET cleared = 1, cleared_at = $1, cleared_by_id = $2, cleared_by_name = $3
     WHERE id = $4`,
    [Date.now(), clearedById, clearedByName, stepId]
  );
}

export async function addStepParticipants(
  stepId: string,
  participants: { userId: string; username: string }[]
): Promise<void> {
  for (const p of participants) {
    await pool.query(
      `INSERT INTO step_participants (step_id, user_id, username)
       VALUES ($1, $2, $3)
       ON CONFLICT (step_id, user_id) DO NOTHING`,
      [stepId, p.userId, p.username]
    );
  }
}

export async function getStepParticipants(stepId: string): Promise<StepParticipant[]> {
  const { rows } = await pool.query<StepParticipant>(
    "SELECT * FROM step_participants WHERE step_id = $1",
    [stepId]
  );
  return rows;
}

// ---------------------------------------------------------------------------
// Reputation helpers
// ---------------------------------------------------------------------------

export async function addReputation(
  userId: string,
  guildId: string,
  username: string,
  points: number
): Promise<void> {
  await pool.query(
    `INSERT INTO reputation (user_id, guild_id, username, points)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (user_id, guild_id) DO UPDATE SET
       points   = reputation.points + excluded.points,
       username = excluded.username`,
    [userId, guildId, username, points]
  );
}

export async function getReputation(
  userId: string,
  guildId: string
): Promise<Reputation | undefined> {
  const { rows } = await pool.query<Reputation>(
    "SELECT * FROM reputation WHERE user_id = $1 AND guild_id = $2",
    [userId, guildId]
  );
  return rows[0];
}

export async function getLeaderboard(
  guildId: string,
  limit = 10
): Promise<Reputation[]> {
  const { rows } = await pool.query<Reputation>(
    "SELECT * FROM reputation WHERE guild_id = $1 ORDER BY points DESC LIMIT $2",
    [guildId, limit]
  );
  return rows;
}

// ---------------------------------------------------------------------------
// Role-message helpers
// ---------------------------------------------------------------------------

export async function upsertRoleMessage(
  skillName: string,
  guildId: string,
  channelId: string,
  messageId: string
): Promise<void> {
  await pool.query(
    `INSERT INTO role_messages (skill_name, guild_id, channel_id, message_id)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (skill_name, guild_id) DO UPDATE SET
       channel_id = excluded.channel_id,
       message_id = excluded.message_id`,
    [skillName, guildId, channelId, messageId]
  );
}

export async function getRoleMessage(
  skillName: string,
  guildId: string
): Promise<{ channel_id: string; message_id: string } | undefined> {
  const { rows } = await pool.query<{ channel_id: string; message_id: string }>(
    "SELECT channel_id, message_id FROM role_messages WHERE skill_name = $1 AND guild_id = $2",
    [skillName, guildId]
  );
  return rows[0];
}

export async function getSkillByMessage(
  messageId: string,
  guildId: string
): Promise<string | undefined> {
  const { rows } = await pool.query<{ skill_name: string }>(
    "SELECT skill_name FROM role_messages WHERE message_id = $1 AND guild_id = $2",
    [messageId, guildId]
  );
  return rows[0]?.skill_name;
}

// ---------------------------------------------------------------------------
// Pending-deletion helpers
// ---------------------------------------------------------------------------

export interface PendingDeletionRow {
  thread_id: string;
  guild_id: string;
  requester_id: string;
  private_channel_id: string | null;
  delete_at: number;
}

export async function upsertPendingDeletion(
  threadId: string,
  guildId: string,
  requesterId: string,
  privateChannelId: string | null,
  deleteAt: number
): Promise<void> {
  await pool.query(
    `INSERT INTO pending_deletions (thread_id, guild_id, requester_id, private_channel_id, delete_at)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (thread_id) DO UPDATE SET
       guild_id           = excluded.guild_id,
       requester_id       = excluded.requester_id,
       private_channel_id = excluded.private_channel_id,
       delete_at          = excluded.delete_at`,
    [threadId, guildId, requesterId, privateChannelId, deleteAt]
  );
}

export async function cancelPendingDeletion(threadId: string): Promise<void> {
  await pool.query(
    "DELETE FROM pending_deletions WHERE thread_id = $1",
    [threadId]
  );
}

export async function getAllPendingDeletions(): Promise<PendingDeletionRow[]> {
  const { rows } = await pool.query<PendingDeletionRow>(
    "SELECT * FROM pending_deletions"
  );
  return rows;
}

export default pool;
