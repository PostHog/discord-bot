# Build stage
FROM node:20-bookworm-slim AS build
WORKDIR /app
# better-sqlite3 compiles a native addon, so we need build tooling here.
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ \
    && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json* ./
RUN npm install
# Both configs: the build script points at tsconfig.build.json, which extends
# tsconfig.json for compiler options and the @/* path aliases tsc-alias rewrites.
COPY tsconfig.json tsconfig.build.json ./
COPY src ./src
RUN npm run build

# Runtime stage
FROM node:20-bookworm-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production
COPY package.json package-lock.json* ./
# Reinstall only production deps (rebuilds the native addon for the runtime image).
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ \
    && npm install --omit=dev \
    && apt-get purge -y python3 make g++ && apt-get autoremove -y \
    && rm -rf /var/lib/apt/lists/*
COPY --from=build /app/dist ./dist

# SQLite config lives here — mount a volume so it persists across restarts.
ENV DATABASE_PATH=/data/bot.sqlite
VOLUME ["/data"]

CMD ["node", "dist/index.js"]
