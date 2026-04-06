import Database from "better-sqlite3";
import { mkdirSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = join(__dirname, "..", "data");
mkdirSync(DATA_DIR, { recursive: true });

const db = new Database(join(DATA_DIR, "grand_exchange.db"));
db.pragma("journal_mode = WAL");

db.exec(`
  CREATE TABLE IF NOT EXISTS challenges (
    id TEXT PRIMARY KEY,
    guild_id TEXT NOT NULL,
    channel_id TEXT NOT NULL,
    message_id TEXT,
    name TEXT NOT NULL,
    deadline_text TEXT NOT NULL,
    deadline_ts INTEGER NOT NULL,
    completed INTEGER DEFAULT 0,
    created_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS challenge_steps (
    id TEXT PRIMARY KEY,
    challenge_id TEXT NOT NULL,
    name TEXT NOT NULL,
    position INTEGER NOT NULL,
    cleared INTEGER DEFAULT 0,
    cleared_at INTEGER,
    cleared_by_id TEXT,
    cleared_by_name TEXT
  );

  CREATE TABLE IF NOT EXISTS step_participants (
    step_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    username TEXT NOT NULL,
    PRIMARY KEY (step_id, user_id)
  );

  CREATE TABLE IF NOT EXISTS reputation (
    user_id TEXT NOT NULL,
    guild_id TEXT NOT NULL,
    username TEXT NOT NULL,
    points INTEGER DEFAULT 0,
    PRIMARY KEY (user_id, guild_id)
  );

  CREATE TABLE IF NOT EXISTS role_messages (
    skill_name TEXT NOT NULL,
    guild_id   TEXT NOT NULL,
    channel_id TEXT NOT NULL,
    message_id TEXT NOT NULL,
    PRIMARY KEY (skill_name, guild_id)
  );
`);

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

export function createChallenge(
  id: string,
  guildId: string,
  channelId: string,
  name: string,
  deadlineText: string,
  deadlineTs: number
): void {
  db.prepare(
    `INSERT INTO challenges (id, guild_id, channel_id, name, deadline_text, deadline_ts, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).run(id, guildId, channelId, name, deadlineText, deadlineTs, Date.now());
}

export function getChallengeByChannel(channelId: string): Challenge | undefined {
  return db
    .prepare("SELECT * FROM challenges WHERE channel_id = ?")
    .get(channelId) as Challenge | undefined;
}

export function getChallengeById(id: string): Challenge | undefined {
  return db
    .prepare("SELECT * FROM challenges WHERE id = ?")
    .get(id) as Challenge | undefined;
}

export function updateChallengeMessageId(challengeId: string, messageId: string): void {
  db.prepare("UPDATE challenges SET message_id = ? WHERE id = ?").run(
    messageId,
    challengeId
  );
}

export function markChallengeCompleted(challengeId: string): void {
  db.prepare("UPDATE challenges SET completed = 1 WHERE id = ?").run(challengeId);
}

export function getAllActiveChallenges(): Challenge[] {
  return db
    .prepare("SELECT * FROM challenges WHERE completed = 0")
    .all() as Challenge[];
}

// ---------------------------------------------------------------------------
// Step helpers
// ---------------------------------------------------------------------------

export function createStep(
  id: string,
  challengeId: string,
  name: string,
  position: number
): void {
  db.prepare(
    `INSERT INTO challenge_steps (id, challenge_id, name, position)
     VALUES (?, ?, ?, ?)`
  ).run(id, challengeId, name, position);
}

export function getSteps(challengeId: string): ChallengeStep[] {
  return db
    .prepare(
      "SELECT * FROM challenge_steps WHERE challenge_id = ? ORDER BY position"
    )
    .all(challengeId) as ChallengeStep[];
}

export function getStepById(stepId: string): ChallengeStep | undefined {
  return db
    .prepare("SELECT * FROM challenge_steps WHERE id = ?")
    .get(stepId) as ChallengeStep | undefined;
}

export function clearStep(
  stepId: string,
  clearedById: string,
  clearedByName: string
): void {
  db.prepare(
    `UPDATE challenge_steps
     SET cleared = 1, cleared_at = ?, cleared_by_id = ?, cleared_by_name = ?
     WHERE id = ?`
  ).run(Date.now(), clearedById, clearedByName, stepId);
}

export function addStepParticipants(
  stepId: string,
  participants: { userId: string; username: string }[]
): void {
  const stmt = db.prepare(
    "INSERT OR IGNORE INTO step_participants (step_id, user_id, username) VALUES (?, ?, ?)"
  );
  const insertAll = db.transaction(
    (parts: { userId: string; username: string }[]) => {
      for (const p of parts) stmt.run(stepId, p.userId, p.username);
    }
  );
  insertAll(participants);
}

export function getStepParticipants(stepId: string): StepParticipant[] {
  return db
    .prepare("SELECT * FROM step_participants WHERE step_id = ?")
    .all(stepId) as StepParticipant[];
}

// ---------------------------------------------------------------------------
// Reputation helpers
// ---------------------------------------------------------------------------

export function addReputation(
  userId: string,
  guildId: string,
  username: string,
  points: number
): void {
  db.prepare(
    `INSERT INTO reputation (user_id, guild_id, username, points)
     VALUES (?, ?, ?, ?)
     ON CONFLICT(user_id, guild_id) DO UPDATE SET
       points = points + excluded.points,
       username = excluded.username`
  ).run(userId, guildId, username, points);
}

export function getReputation(
  userId: string,
  guildId: string
): Reputation | undefined {
  return db
    .prepare("SELECT * FROM reputation WHERE user_id = ? AND guild_id = ?")
    .get(userId, guildId) as Reputation | undefined;
}

export function getLeaderboard(
  guildId: string,
  limit = 10
): Reputation[] {
  return db
    .prepare(
      "SELECT * FROM reputation WHERE guild_id = ? ORDER BY points DESC LIMIT ?"
    )
    .all(guildId, limit) as Reputation[];
}

// ---------------------------------------------------------------------------
// Role-message helpers
// ---------------------------------------------------------------------------

export function upsertRoleMessage(
  skillName: string,
  guildId: string,
  channelId: string,
  messageId: string
): void {
  db.prepare(
    `INSERT INTO role_messages (skill_name, guild_id, channel_id, message_id)
     VALUES (?, ?, ?, ?)
     ON CONFLICT(skill_name, guild_id) DO UPDATE SET
       channel_id = excluded.channel_id,
       message_id = excluded.message_id`
  ).run(skillName, guildId, channelId, messageId);
}

export function getRoleMessage(
  skillName: string,
  guildId: string
): { channel_id: string; message_id: string } | undefined {
  return db
    .prepare(
      "SELECT channel_id, message_id FROM role_messages WHERE skill_name = ? AND guild_id = ?"
    )
    .get(skillName, guildId) as { channel_id: string; message_id: string } | undefined;
}

export function getSkillByMessage(
  messageId: string,
  guildId: string
): string | undefined {
  const row = db
    .prepare(
      "SELECT skill_name FROM role_messages WHERE message_id = ? AND guild_id = ?"
    )
    .get(messageId, guildId) as { skill_name: string } | undefined;
  return row?.skill_name;
}

export default db;
