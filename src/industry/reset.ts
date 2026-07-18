import type { Kysely } from "kysely";
import type { DatabaseSchema } from "../db/types.js";

export interface IndustryResetResult {
  events: number;
  signals: number;
  runs: number;
  jobs: number;
}

export async function resetIndustryIntelligence(
  db: Kysely<DatabaseSchema>,
): Promise<IndustryResetResult> {
  return db.transaction().execute(async (transaction) => {
    const eventCount = await countRows(transaction, "events");
    const signalCount = await countRows(transaction, "signals");
    const runCount = await countRows(transaction, "source_runs");
    const jobCount = await transaction
      .selectFrom("jobs")
      .select(({ fn }) => fn.countAll<number>().as("count"))
      .where("type", "=", "collect")
      .executeTakeFirstOrThrow();
    await transaction.deleteFrom("event_merges").execute();
    await transaction.deleteFrom("scout_insights").execute();
    await transaction.deleteFrom("events").execute();
    await transaction.deleteFrom("signals").execute();
    await transaction.deleteFrom("source_runs").execute();
    await transaction.deleteFrom("jobs").where("type", "=", "collect").execute();
    await transaction
      .updateTable("sources")
      .set({ state_json: "{}", last_collected_at: null, last_success_at: null, last_error: null })
      .execute();
    return {
      events: eventCount,
      signals: signalCount,
      runs: runCount,
      jobs: Number(jobCount.count),
    };
  });
}

async function countRows(
  db: Kysely<DatabaseSchema>,
  table: "events" | "signals" | "source_runs",
): Promise<number> {
  const row = await db
    .selectFrom(table)
    .select(({ fn }) => fn.countAll<number>().as("count"))
    .executeTakeFirstOrThrow();
  return Number(row.count);
}
