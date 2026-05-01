// Wispbyte entry point: node start.cjs
// Loads .env file first, then registers tsx to run TypeScript directly.
require("dotenv").config();
require("tsx/cjs");
require("./src/index.ts");
