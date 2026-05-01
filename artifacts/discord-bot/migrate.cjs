// One-time migration: reads grand_exchange.db (SQLite) → writes to PostgreSQL (Neon)
// Runs automatically on startup if the db file exists, then renames it so it never runs twice.

const path = require("path");
const fs = require("fs");

async function migrate() {
  const dbPath = path.join(__dirname, "grand_exchange.db");
  if (!fs.existsSync(dbPath)) return; // nothing to migrate

  console.log("📦 Found SQLite database — starting one-time migration to PostgreSQL...");

  let SQL, db;
  try {
    const initSqlJs = require("sql.js");
    SQL = await initSqlJs();
    const fileBuffer = fs.readFileSync(dbPath);
    db = new SQL.Database(fileBuffer);
  } catch (err) {
    console.error("❌ Could not open SQLite database:", err.message);
    return;
  }

  const { Client } = require("pg");
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();

  // --- reputation ---
  try {
    const result = db.exec("SELECT user_id, guild_id, username, points FROM reputation");
    if (result.length > 0) {
      let count = 0;
      for (const row of result[0].values) {
        const [userId, guildId, username, points] = row;
        await client.query(
          `INSERT INTO reputation (user_id, guild_id, username, points)
           VALUES ($1, $2, $3, $4)
           ON CONFLICT (user_id, guild_id) DO UPDATE SET
             points   = excluded.points,
             username = excluded.username`,
          [userId, guildId, username, points]
        );
        count++;
      }
      console.log(`✅ Migrated ${count} reputation record(s)`);
    } else {
      console.log("ℹ️  No reputation records found in SQLite");
    }
  } catch (err) {
    console.error("⚠️  Reputation migration failed:", err.message);
  }

  // --- role_messages ---
  try {
    const result = db.exec("SELECT skill_name, guild_id, channel_id, message_id FROM role_messages");
    if (result.length > 0) {
      let count = 0;
      for (const row of result[0].values) {
        const [skillName, guildId, channelId, messageId] = row;
        await client.query(
          `INSERT INTO role_messages (skill_name, guild_id, channel_id, message_id)
           VALUES ($1, $2, $3, $4)
           ON CONFLICT (skill_name, guild_id) DO UPDATE SET
             channel_id = excluded.channel_id,
             message_id = excluded.message_id`,
          [skillName, guildId, channelId, messageId]
        );
        count++;
      }
      console.log(`✅ Migrated ${count} role message record(s)`);
    } else {
      console.log("ℹ️  No role message records found in SQLite");
    }
  } catch (err) {
    console.error("⚠️  Role messages migration failed:", err.message);
  }

  await client.end();
  db.close();

  // Rename the db files so migration never runs again
  for (const ext of ["", "-shm", "-wal"]) {
    const f = dbPath + ext;
    if (fs.existsSync(f)) fs.renameSync(f, f + ".migrated");
  }

  console.log("✅ Migration complete! SQLite files renamed to *.migrated");
}

module.exports = migrate;
