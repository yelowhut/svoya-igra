# --- web build ---
FROM node:20-slim AS web
WORKDIR /web
COPY web/package*.json ./
RUN npm install --no-audit --no-fund --no-progress
COPY web/ ./
RUN npm run build

# --- server build ---
FROM node:20-slim AS server
WORKDIR /app
COPY package*.json ./
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ && rm -rf /var/lib/apt/lists/*
RUN npm ci
COPY tsconfig.json ./
COPY src/ ./src/
RUN npm run build

# --- runtime ---
FROM node:20-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production
COPY package*.json ./
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ && rm -rf /var/lib/apt/lists/*
RUN npm ci --omit=dev
COPY --from=server /app/dist ./dist
COPY --from=web /web/dist ./web/dist
EXPOSE 3000
VOLUME ["/app/data"]
CMD ["node", "dist/index.js"]
