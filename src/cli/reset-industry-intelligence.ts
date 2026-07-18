import { loadConfig } from "../config/env.js";
import { createDatabase } from "../db/database.js";
import { migrateToLatest } from "../db/migrate.js";
import { resetIndustryIntelligence } from "../industry/reset.js";
import { resetIndustryViewpoints } from "../industry/viewpoints.js";

const config = loadConfig();
if (!config.INDUSTRY_PROFILE) throw new Error("INDUSTRY_PROFILE is required");
const confirmed = process.argv.includes("--confirm");
if (!confirmed) throw new Error("Use --confirm to reset the isolated industry intelligence state");

const db = createDatabase(config);
try {
  await migrateToLatest(db, config);
  const result = await resetIndustryIntelligence(db);
  await resetIndustryViewpoints(config.INDUSTRY_PROFILE, config.rootDir);
  console.log(JSON.stringify({ ...result, viewpoints: "reset" }, null, 2));
} finally {
  await db.destroy();
}
