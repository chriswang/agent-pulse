import type { Kysely } from "kysely";
import type { AppConfig } from "../config/env.js";
import { restoreRepositorySnapshot } from "../pipeline/snapshot.js";
import { migrateToLatest } from "./migrate.js";
import { seedDatabase } from "./seed.js";
import type { DatabaseSchema } from "./types.js";

interface BootstrapOptions {
  snapshotRootDir?: string;
  snapshotFile?: string;
}

export async function bootstrapRepositoryDatabase(
  db: Kysely<DatabaseSchema>,
  config: AppConfig,
  options: BootstrapOptions = {},
) {
  await migrateToLatest(db, config);
  await seedDatabase(db);
  const snapshot = await restoreRepositorySnapshot(
    db,
    options.snapshotRootDir ?? config.rootDir,
    options.snapshotFile ?? config.REPOSITORY_SNAPSHOT_PATH,
  );
  if (!snapshot.restored) {
    throw new Error(`Repository snapshot is required for startup: ${snapshot.path}`);
  }
  return snapshot;
}
