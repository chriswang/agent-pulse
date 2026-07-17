import { mkdir } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { loadConfig } from "../config/env.js";
import { createDatabase } from "../db/database.js";
import { migrateToLatest } from "../db/migrate.js";
import { buildIndustryPilotReport, writeIndustryPilotReport } from "../industry/pilot-report.js";
import { loadIndustryProfile } from "../industry/profile.js";

export async function runIndustryPilotReportCli(args = process.argv.slice(2)): Promise<void> {
  const config = loadConfig();
  const profile = loadIndustryProfile(config.INDUSTRY_PROFILE, config.rootDir);
  if (!profile) throw new Error("INDUSTRY_PROFILE is required");
  const outputArgument = valueFor(args, "--output");
  const output = outputArgument
    ? resolve(config.rootDir, outputArgument)
    : join(config.rootDir, "industry-packs", profile.slug, "data", "pilot-report.json");
  const allowedRoot = join(config.rootDir, "industry-packs", profile.slug, "data");
  if (output !== allowedRoot && !output.startsWith(`${allowedRoot}/`)) {
    throw new Error("pilot_report_output_must_stay_in_industry_pack");
  }
  const db = createDatabase(config);
  try {
    await migrateToLatest(db, config);
    const report = await buildIndustryPilotReport(db, profile, config.rootDir);
    await mkdir(dirname(output), { recursive: true });
    await writeIndustryPilotReport(report, output);
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  } finally {
    await db.destroy();
  }
}

function valueFor(args: string[], name: string): string | undefined {
  const inline = args.find((argument) => argument.startsWith(`${name}=`));
  if (inline) return inline.slice(name.length + 1);
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : undefined;
}

const currentFile = fileURLToPath(import.meta.url);
if (process.argv[1] && resolve(process.argv[1]) === currentFile) {
  await runIndustryPilotReportCli();
}
