import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { loadConfig } from "../config/env.js";
import { loadIndustryProfile } from "../industry/profile.js";
import { evaluateIndustrySourceGate, type SourceGateAuditReport } from "../industry/source-gate.js";

export async function runIndustrySourceGateCli(args = process.argv.slice(2)): Promise<void> {
  const config = loadConfig();
  const profile = loadIndustryProfile(config.INDUSTRY_PROFILE, config.rootDir);
  if (!profile) throw new Error("INDUSTRY_PROFILE is required");
  const reportArgument = valueFor(args, "--report");
  if (!reportArgument) throw new Error("--report is required");
  const reportPath = resolve(config.rootDir, reportArgument);
  const report = JSON.parse(await readFile(reportPath, "utf8")) as SourceGateAuditReport;
  if (!Array.isArray(report.results)) throw new Error("invalid_source_audit_report");
  const result = evaluateIndustrySourceGate(profile, report);
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  if (!result.pass) process.exitCode = 1;
}

function valueFor(args: string[], name: string): string | undefined {
  const inline = args.find((argument) => argument.startsWith(`${name}=`));
  if (inline) return inline.slice(name.length + 1);
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : undefined;
}

const currentFile = fileURLToPath(import.meta.url);
if (process.argv[1] && resolve(process.argv[1]) === currentFile) {
  await runIndustrySourceGateCli();
}
