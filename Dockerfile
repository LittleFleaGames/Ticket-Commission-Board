FROM node:20-slim

# Build tools required for better-sqlite3 native compilation
RUN apt-get update && apt-get install -y \
    python3 \
    make \
    g++ \
    && rm -rf /var/lib/apt/lists/*

# Install pnpm
RUN npm install -g pnpm@9

WORKDIR /app

# Copy workspace-level config files
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml tsconfig.base.json tsconfig.json ./

# Copy only the discord bot package (and shared lib in case tsconfig references it)
COPY artifacts/discord-bot ./artifacts/discord-bot
COPY lib ./lib

# Install dependencies (frozen lockfile = reproducible build)
RUN pnpm install --frozen-lockfile

# Ensure the SQLite data directory exists and persists
RUN mkdir -p /app/artifacts/discord-bot/data

CMD ["pnpm", "--filter", "@workspace/discord-bot", "run", "start"]
