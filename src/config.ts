export const config = {
  port: Number(process.env.PORT ?? 3000),
  minReactionMs: Number(process.env.MIN_REACTION_MS ?? 100),
  blockMinMs: Number(process.env.BLOCK_MIN_MS ?? 500),
  blockMaxMs: Number(process.env.BLOCK_MAX_MS ?? 700),
  snapshotEvery: Number(process.env.SNAPSHOT_EVERY ?? 25),
  dbPath: process.env.DB_PATH ?? 'data/game.db',
  mediaDir: process.env.MEDIA_DIR ?? 'data/media',
};
export type Config = typeof config;
