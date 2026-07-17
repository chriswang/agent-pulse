import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { createJsonModelClient } from "../ai/provider.js";
import { loadConfig } from "../config/env.js";
import { decideMonitorAlert, type MonitorIncidentContext } from "../pipeline/monitor-alert.js";

async function main(args = process.argv.slice(2)): Promise<void> {
  const reportPath = requiredValue(args, "--report");
  const incidentPath = valueFor(args, "--incident");
  const report = JSON.parse(await readFile(resolve(reportPath), "utf8"));
  const incident = incidentPath
    ? (JSON.parse(await readFile(resolve(incidentPath), "utf8")) as
        | MonitorIncidentContext
        | MonitorIncidentContext[])
    : null;
  const useAi = args.includes("--ai");
  const config = useAi ? loadConfig() : null;
  const client =
    useAi && config
      ? createJsonModelClient(config, {
          timeoutMs: config.AI_ENRICHMENT_TIMEOUT_MS,
          maxAttempts: 2,
        })
      : undefined;
  const decision = await decideMonitorAlert({
    report,
    incident,
    ...(client ? { client } : {}),
    mode: args.includes("--dry-run") ? "dry-run" : "notify",
  });
  process.stdout.write(`${JSON.stringify(decision, null, 2)}\n`);
}

function valueFor(args: string[], name: string): string | undefined {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : undefined;
}

function requiredValue(args: string[], name: string): string {
  const value = valueFor(args, name);
  if (!value) throw new Error(`${name} is required`);
  return value;
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
