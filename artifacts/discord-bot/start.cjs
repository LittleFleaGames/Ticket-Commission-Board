// Wispbyte entry point: node start.cjs
// 1. Loads .env
// 2. Runs one-time SQLite → PostgreSQL migration if grand_exchange.db is present
// 3. Starts the bot

require("dotenv").config();

const migrate = require("./migrate.cjs");

migrate()
  .then(() => {
    require("tsx/cjs");
    require("./src/index.ts");
  })
  .catch((err) => {
    console.error("❌ Migration failed — aborting startup:", err);
    process.exit(1);
  });
