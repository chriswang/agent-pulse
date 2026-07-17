import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { Kysely } from "kysely";
import { z } from "zod";
import { Repository } from "../db/repository.js";
import type { DatabaseSchema } from "../db/types.js";
import type { EnrichedEvent } from "../pipeline/static-site/dto.js";
import type { IndustryProfile } from "./profile.js";

const manualReviewSchema = z
  .object({
    schemaVersion: z.literal(1),
    clusteringAccuracyPercent: z.number().min(0).max(100).nullable(),
    top10DecisionValueCount: z.number().int().min(0).max(10).nullable(),
    dailyMinutesBefore: z.number().min(0).max(1_440).nullable(),
    dailyMinutesAfter: z.number().min(0).max(1_440).nullable(),
    notes: z.array(z.string().min(1).max(500)).max(20),
  })
  .strict();

export interface IndustryPilotReport {
  schemaVersion: 1;
  profileSlug: string;
  generatedAt: string;
  window: { start: string; end: string; targetDays: number; observedDays: number };
  sources: {
    configured: number;
    automated: number;
    manual: number;
    audited: number;
    healthy: number;
    degraded: number;
    failed: number;
    unchecked: number;
    healthRatePercent: number | null;
  };
  collection: {
    runs: number;
    successfulRuns: number;
    failedRuns: number;
    successRatePercent: number | null;
    targetPercent: number;
    status: "pending" | "pass" | "fail";
  };
  intelligence: {
    signals: number;
    publishedEvents: number;
    multiSourceEvents: number;
    multiSourceRatePercent: number | null;
    highPriorityEvents: number;
    highPriorityEvidenceCoveragePercent: number | null;
  };
  topCandidates: Array<{
    slug: string;
    title: string;
    company: string;
    happenedAt: string;
    priorityScore: number;
    sourceCount: number;
    evidenceUrls: string[];
  }>;
  manualReview: {
    clusteringAccuracyPercent: number | null;
    top10DecisionValueCount: number | null;
    dailyMinutesBefore: number | null;
    dailyMinutesAfter: number | null;
    dailyMinutesSaved: number | null;
    status: "pending" | "complete";
    notes: string[];
  };
  readiness: "collecting" | "ready_for_manual_review" | "pass" | "fail";
}

export async function buildIndustryPilotReport(
  db: Kysely<DatabaseSchema>,
  profile: IndustryProfile,
  rootDir: string,
  referenceAt = new Date().toISOString(),
): Promise<IndustryPilotReport> {
  const repository = new Repository(db);
  const reference = new Date(referenceAt);
  const start = new Date(reference.getTime() - profile.trial.durationDays * 86_400_000);
  const [sources, checks, events, runs, signalCount, manualReview] = await Promise.all([
    repository.listSources(),
    repository.latestSourceChecks(),
    repository.publicEvents(),
    db
      .selectFrom("source_runs")
      .innerJoin("sources", "sources.id", "source_runs.source_id")
      .select([
        "source_runs.status",
        "source_runs.started_at as startedAt",
        "source_runs.finished_at as finishedAt",
        "sources.slug as sourceSlug",
      ])
      .where("source_runs.started_at", ">=", start.toISOString())
      .execute(),
    db
      .selectFrom("signals")
      .select(({ fn }) => fn.countAll<number>().as("count"))
      .where("created_at", ">=", start.toISOString())
      .executeTakeFirstOrThrow(),
    readManualReview(rootDir, profile.slug),
  ]);
  const automatedSlugs = new Set(
    profile.sources
      .filter(
        (source) =>
          source.adapter !== "manual" &&
          !["manual", "restricted"].includes(source.maintenanceStatus),
      )
      .map((source) => source.slug),
  );
  const automatedRuns = runs.filter((run) => automatedSlugs.has(run.sourceSlug));
  const successfulRuns = automatedRuns.filter((run) =>
    ["succeeded", "not_modified"].includes(run.status),
  );
  const checksBySource = new Map(checks.map((check) => [check.source_id, check]));
  const automatedSources = sources.filter((source) => automatedSlugs.has(source.slug));
  const audited = automatedSources.filter((source) => checksBySource.has(source.id));
  const healthy = audited.filter((source) => checksBySource.get(source.id)?.status === "healthy");
  const degraded = audited.filter((source) => checksBySource.get(source.id)?.status === "degraded");
  const failed = audited.filter((source) => checksBySource.get(source.id)?.status === "failed");
  const eventSourceRows = events.length
    ? await db
        .selectFrom("event_signals")
        .innerJoin("signals", "signals.id", "event_signals.signal_id")
        .innerJoin("sources", "sources.id", "signals.source_id")
        .select([
          "event_signals.event_id as eventId",
          "sources.slug as sourceSlug",
          "sources.tier as sourceTier",
          "sources.role as sourceRole",
        ])
        .where(
          "event_signals.event_id",
          "in",
          events.map((event) => event.id),
        )
        .execute()
    : [];
  const sourceRowsByEvent = new Map<string, typeof eventSourceRows>();
  for (const row of eventSourceRows) {
    const current = sourceRowsByEvent.get(row.eventId) ?? [];
    current.push(row);
    sourceRowsByEvent.set(row.eventId, current);
  }
  const eventsInWindow = (events as EnrichedEvent[]).filter(
    (event) => event.happenedAt >= start.toISOString(),
  );
  const sourceCount = (event: EnrichedEvent) =>
    new Set(sourceRowsByEvent.get(event.id)?.map((row) => row.sourceSlug) ?? []).size;
  const multiSourceEvents = eventsInWindow.filter((event) => sourceCount(event) >= 2);
  const highPriorityEvents = eventsInWindow.filter(
    (event) => event.confidenceScore >= 80 && event.impactScore >= 80 && event.valueScore >= 70,
  );
  const evidenceReady = highPriorityEvents.filter((event) => {
    const rows = sourceRowsByEvent.get(event.id) ?? [];
    return (
      event.evidence.length > 0 &&
      rows.some((row) => row.sourceTier === 1 && !["aggregator", "heat"].includes(row.sourceRole))
    );
  });
  const earliestObservation = [
    ...runs.map((run) => run.startedAt),
    ...checks.map((check) => check.finished_at),
  ]
    .filter(Boolean)
    .sort()[0];
  const observedDays = earliestObservation
    ? Math.min(
        profile.trial.durationDays,
        Math.max(
          1,
          Math.ceil((reference.getTime() - Date.parse(earliestObservation)) / 86_400_000),
        ),
      )
    : 0;
  const successRatePercent = percent(successfulRuns.length, automatedRuns.length);
  const collectionStatus =
    successRatePercent === null
      ? "pending"
      : successRatePercent >= profile.trial.minimumCollectionSuccessRate
        ? "pass"
        : "fail";
  const manualComplete = [
    manualReview.clusteringAccuracyPercent,
    manualReview.top10DecisionValueCount,
    manualReview.dailyMinutesBefore,
    manualReview.dailyMinutesAfter,
  ].every((value) => value !== null);
  const deterministicReady =
    observedDays >= profile.trial.durationDays &&
    automatedRuns.length > 0 &&
    multiSourceEvents.length > 0 &&
    highPriorityEvents.length > 0;
  const readiness: IndustryPilotReport["readiness"] = !deterministicReady
    ? "collecting"
    : !manualComplete
      ? "ready_for_manual_review"
      : collectionStatus === "pass" && evidenceReady.length === highPriorityEvents.length
        ? "pass"
        : "fail";

  return {
    schemaVersion: 1,
    profileSlug: profile.slug,
    generatedAt: reference.toISOString(),
    window: {
      start: start.toISOString(),
      end: reference.toISOString(),
      targetDays: profile.trial.durationDays,
      observedDays,
    },
    sources: {
      configured: profile.sources.length,
      automated: automatedSlugs.size,
      manual: profile.sources.length - automatedSlugs.size,
      audited: audited.length,
      healthy: healthy.length,
      degraded: degraded.length,
      failed: failed.length,
      unchecked: automatedSources.length - audited.length,
      healthRatePercent: percent(healthy.length, audited.length),
    },
    collection: {
      runs: automatedRuns.length,
      successfulRuns: successfulRuns.length,
      failedRuns: automatedRuns.length - successfulRuns.length,
      successRatePercent,
      targetPercent: profile.trial.minimumCollectionSuccessRate,
      status: collectionStatus,
    },
    intelligence: {
      signals: Number(signalCount.count),
      publishedEvents: eventsInWindow.length,
      multiSourceEvents: multiSourceEvents.length,
      multiSourceRatePercent: percent(multiSourceEvents.length, eventsInWindow.length),
      highPriorityEvents: highPriorityEvents.length,
      highPriorityEvidenceCoveragePercent: percent(evidenceReady.length, highPriorityEvents.length),
    },
    topCandidates: [...eventsInWindow]
      .sort(
        (left, right) =>
          priorityScore(right) - priorityScore(left) ||
          right.happenedAt.localeCompare(left.happenedAt),
      )
      .slice(0, profile.trial.topN)
      .map((event) => ({
        slug: event.slug,
        title: event.title,
        company: event.company,
        happenedAt: event.happenedAt,
        priorityScore: priorityScore(event),
        sourceCount: sourceCount(event),
        evidenceUrls: event.evidence.map((evidence) => evidence.url),
      })),
    manualReview: {
      clusteringAccuracyPercent: manualReview.clusteringAccuracyPercent,
      top10DecisionValueCount: manualReview.top10DecisionValueCount,
      dailyMinutesBefore: manualReview.dailyMinutesBefore,
      dailyMinutesAfter: manualReview.dailyMinutesAfter,
      dailyMinutesSaved:
        manualReview.dailyMinutesBefore !== null && manualReview.dailyMinutesAfter !== null
          ? manualReview.dailyMinutesBefore - manualReview.dailyMinutesAfter
          : null,
      status: manualComplete ? "complete" : "pending",
      notes: manualReview.notes,
    },
    readiness,
  };
}

export async function writeIndustryPilotReport(
  report: IndustryPilotReport,
  path: string,
): Promise<void> {
  await writeFile(path, `${JSON.stringify(report, null, 2)}\n`, "utf8");
}

async function readManualReview(rootDir: string, slug: string) {
  const path = join(rootDir, "industry-packs", slug, "data", "manual-review.json");
  const value = JSON.parse(await readFile(path, "utf8"));
  return manualReviewSchema.parse(value);
}

function priorityScore(event: EnrichedEvent): number {
  return Math.round(
    event.impactScore * 0.4 +
      event.valueScore * 0.3 +
      event.confidenceScore * 0.2 +
      event.heatScore * 0.1,
  );
}

function percent(numerator: number, denominator: number): number | null {
  return denominator > 0 ? Math.round((numerator / denominator) * 1_000) / 10 : null;
}
