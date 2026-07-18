import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createJsonModelClient, resolveModelIdentity } from "../ai/provider.js";
import { loadConfig } from "../config/env.js";
import { createDatabase } from "../db/database.js";
import { migrateToLatest } from "../db/migrate.js";
import { loadIndustryProfile } from "../industry/profile.js";
import { analyzeIndustryViewpoints } from "../industry/viewpoints.js";

export async function runIndustryViewpointsCli(): Promise<void> {
  const config = loadConfig();
  const profile = loadIndustryProfile(config.INDUSTRY_PROFILE, config.rootDir);
  if (!profile) throw new Error("INDUSTRY_PROFILE is required");
  if (!config.AI_ENRICHMENT_ENABLED) {
    process.stdout.write(
      `${JSON.stringify({ enabled: false, skipped: "AI_ENRICHMENT_ENABLED is false" })}\n`,
    );
    return;
  }
  const db = createDatabase(config);
  try {
    await migrateToLatest(db, config);
    const identity = resolveModelIdentity(config);
    const report = await analyzeIndustryViewpoints(
      db,
      profile,
      config.rootDir,
      createJsonModelClient(config, {
        timeoutMs: Math.max(config.AI_ENRICHMENT_TIMEOUT_MS, 90_000),
        maxAttempts: 2,
      }),
      identity,
    );
    process.stdout.write(`${JSON.stringify({ enabled: true, ...report }, null, 2)}\n`);
    if (report.model.status === "failed") process.exitCode = 1;
  } finally {
    await db.destroy();
  }
}

const currentFile = fileURLToPath(import.meta.url);
if (process.argv[1] && resolve(process.argv[1]) === currentFile) {
  await runIndustryViewpointsCli();
}
