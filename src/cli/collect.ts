import { loadConfig } from "../config/env.js";
import { createDatabase } from "../db/database.js";
import { migrateToLatest } from "../db/migrate.js";
import { clusterSignals } from "../pipeline/cluster.js";
import { collectSources } from "../pipeline/collect.js";

const config = loadConfig();
const db = createDatabase(config);
try {
  await migrateToLatest(db, config);
  const backfill = process.argv.includes("--backfill");
  const drain = process.argv.includes("--drain");
  const sourceId = process.argv.find((argument) => argument.startsWith("--source="))?.split("=")[1];
  const scopeArgument = process.argv
    .find((argument) => argument.startsWith("--scope="))
    ?.split("=")[1];
  if (scopeArgument && scopeArgument !== "eligible" && scopeArgument !== "all") {
    throw new Error("--scope must be eligible or all");
  }
  const scope = scopeArgument === "all" ? "all" : "eligible";
  const collection = await collectSources(db, config, {
    ...(sourceId ? { sourceId } : {}),
    scope,
    resetState: backfill,
  });
  if (backfill) console.log("[collect] bounded backfill enabled for selected sources");
  const industryContext = {
    ...(config.INDUSTRY_PROFILE ? { industryProfileSlug: config.INDUSTRY_PROFILE } : {}),
    rootDir: config.rootDir,
  };
  let clustering = await clusterSignals(db, industryContext);
  if (drain) {
    for (let round = 1; round < 100; round += 1) {
      const progress = clustering.created + clustering.attached + clustering.deferred;
      if (progress === 0) break;
      const next = await clusterSignals(db, industryContext);
      clustering = {
        created: clustering.created + next.created,
        attached: clustering.attached + next.attached,
        deferred: clustering.deferred + next.deferred,
      };
      if (next.created + next.attached + next.deferred === 0) break;
    }
  }
  console.log(JSON.stringify({ collection, clustering }, null, 2));
} finally {
  await db.destroy();
}
