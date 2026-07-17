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
  const lookbackDays = numericArgument("--lookback-days");
  const maxPages = numericArgument("--max-pages");
  if (lookbackDays !== undefined && !backfill) {
    throw new Error("--lookback-days requires --backfill");
  }
  if (lookbackDays !== undefined && (lookbackDays < 1 || lookbackDays > 365)) {
    throw new Error("--lookback-days must be between 1 and 365");
  }
  if (maxPages !== undefined && (maxPages < 1 || maxPages > 20)) {
    throw new Error("--max-pages must be between 1 and 20");
  }
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
    ...(lookbackDays !== undefined ? { lookbackDays } : {}),
    ...(maxPages !== undefined ? { maxPages } : {}),
  });
  if (backfill) {
    console.log(
      `[collect] bounded backfill enabled${lookbackDays ? ` for ${lookbackDays} days` : ""}${maxPages ? ` across at most ${maxPages} pages per source` : ""}`,
    );
  }
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

function numericArgument(name: string): number | undefined {
  const value = process.argv.find((argument) => argument.startsWith(`${name}=`))?.split("=")[1];
  if (value === undefined) return undefined;
  if (!/^\d+$/.test(value)) throw new Error(`${name} must be an integer`);
  return Number(value);
}
