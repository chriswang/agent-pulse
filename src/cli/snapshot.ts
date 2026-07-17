import { loadConfig } from "../config/env.js";
import { createDatabase } from "../db/database.js";
import { migrateToLatest } from "../db/migrate.js";
import { seedDatabase } from "../db/seed.js";
import { restoreRepositorySnapshot, writeRepositorySnapshot } from "../pipeline/snapshot.js";

const command = process.argv[2];
if (command !== "restore" && command !== "merge" && command !== "write") {
  throw new Error("Usage: npm run db:snapshot -- <restore|merge|write> [--file=<path>]");
}
const snapshotFile = process.argv.find((argument) => argument.startsWith("--file="))?.slice(7);

const config = loadConfig();
const db = createDatabase(config);
try {
  await migrateToLatest(db, config);
  const result =
    command === "restore" || command === "merge"
      ? await restoreSnapshot(command === "restore")
      : await writeRepositorySnapshot(
          db,
          config.rootDir,
          snapshotFile ?? config.REPOSITORY_SNAPSHOT_PATH,
        );
  console.log(JSON.stringify(result, null, 2));
} finally {
  await db.destroy();
}

async function restoreSnapshot(seed: boolean) {
  if (seed) await seedDatabase(db);
  return restoreRepositorySnapshot(
    db,
    config.rootDir,
    snapshotFile ?? config.REPOSITORY_SNAPSHOT_PATH,
  );
}
