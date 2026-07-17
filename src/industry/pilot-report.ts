import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { Kysely } from "kysely";
import { z } from "zod";
import { Repository } from "../db/repository.js";
import type { DatabaseSchema } from "../db/types.js";
import { sourcePublisherKey } from "../domain/source-identity.js";
import type { EnrichedEvent } from "../pipeline/static-site/dto.js";
import type { IndustryProfile } from "./profile.js";
import {
  assessStoredIndustryScope,
  loadIndustryRules,
  scopeAssessmentFromSignal,
} from "./rules.js";

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
  window: {
    start: string;
    end: string;
    targetDays: number;
    observedDays: number;
    historyStart: string;
    historyEnd: string;
    historyLookbackDays: number;
  };
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
    chineseConfigured: number;
    chineseHealthy: number;
    chineseReadyPublishers: number;
    minimumChineseReady: number;
    chinaContentTargetPercent: number;
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
  const rules = loadIndustryRules(profile.slug, rootDir);
  const reference = new Date(referenceAt);
  const targetDays =
    profile.trial.phase === "baseline" ? profile.trial.baselineDays : profile.trial.durationDays;
  const validationStart =
    profile.trial.phase === "baseline"
      ? new Date(`${profile.trial.baselineStartDate}T00:00:00.000Z`)
      : new Date(`${profile.trial.validationStartDate}T00:00:00.000Z`);
  const targetEnd = new Date(validationStart.getTime() + (targetDays - 1) * 86_400_000);
  const validationEndExclusive = new Date(validationStart.getTime() + targetDays * 86_400_000);
  const historyStart = new Date(
    validationStart.getTime() - profile.trial.historyLookbackDays * 86_400_000,
  );
  const evidenceEndExclusive = new Date(reference.getTime() + 1);
  const [sources, checks, events, runs, signalRows, manualReview] = await Promise.all([
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
      .where("source_runs.started_at", ">=", validationStart.toISOString())
      .where("source_runs.started_at", "<", validationEndExclusive.toISOString())
      .execute(),
    db
      .selectFrom("signals")
      .innerJoin("sources", "sources.id", "signals.source_id")
      .select([
        "signals.title",
        "signals.summary",
        "signals.tags_json",
        "signals.raw_meta_json",
        "signals.created_at as createdAt",
        "signals.published_at as publishedAt",
        "sources.slug",
        "sources.region",
      ])
      .execute(),
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
          "sources.homepage_url as homepageUrl",
          "sources.tier as sourceTier",
          "sources.role as sourceRole",
          "signals.title",
          "signals.summary",
          "signals.tags_json",
          "signals.raw_meta_json",
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
  const eligibleEventIds = new Set(
    eventSourceRows
      .filter((row) =>
        rules
          ? assessStoredIndustryScope(row, { slug: row.sourceSlug }, rules).decision === "include"
          : true,
      )
      .map((row) => row.eventId),
  );
  const eventsInWindow = (events as EnrichedEvent[]).filter(
    (event) =>
      event.happenedAt >= historyStart.toISOString() &&
      event.happenedAt < evidenceEndExclusive.toISOString() &&
      eligibleEventIds.has(event.id),
  );
  const sourceCount = (event: EnrichedEvent) =>
    new Set(
      (sourceRowsByEvent.get(event.id) ?? []).map((row) =>
        sourcePublisherKey(row.homepageUrl, row.sourceSlug),
      ),
    ).size;
  const multiSourceEvents = eventsInWindow.filter((event) => sourceCount(event) >= 2);
  const highPriorityThresholds = rules?.publication ?? {
    highPriorityConfidence: 80,
    highPriorityImpact: 80,
    highPriorityValue: 70,
  };
  const meetsHighPriorityEvidenceStandard = (event: EnrichedEvent) => {
    const rows = sourceRowsByEvent.get(event.id) ?? [];
    const independentPublishers = new Set(
      rows.map((row) => sourcePublisherKey(row.homepageUrl, row.sourceSlug)),
    ).size;
    const hasPrimary = rows.some(
      (row) => row.sourceTier === 1 && !["aggregator", "heat"].includes(row.sourceRole),
    );
    const independentSecondary = new Set(
      rows
        .filter((row) => row.sourceTier === 2 && !["aggregator", "heat"].includes(row.sourceRole))
        .map((row) => sourcePublisherKey(row.homepageUrl, row.sourceSlug)),
    ).size;
    return independentPublishers >= 2 && (hasPrimary || independentSecondary >= 2);
  };
  const highPriorityEvents = eventsInWindow.filter(
    (event) =>
      event.confidenceScore >= highPriorityThresholds.highPriorityConfidence &&
      event.impactScore >= highPriorityThresholds.highPriorityImpact &&
      event.valueScore >= highPriorityThresholds.highPriorityValue &&
      meetsHighPriorityEvidenceStandard(event),
  );
  const evidenceReady = highPriorityEvents.filter((event) => {
    return (
      event.evidence.length > 0 &&
      event.evidence.every((evidence) => evidence.url.startsWith("https://")) &&
      meetsHighPriorityEvidenceStandard(event)
    );
  });
  const observedDays = Math.min(
    targetDays,
    new Set(successfulRuns.map((run) => run.startedAt.slice(0, 10))).size,
  );
  const chineseSources = automatedSources.filter((source) => source.region === "CN");
  const chineseHealthy = chineseSources.filter(
    (source) => checksBySource.get(source.id)?.status === "healthy",
  );
  const readySourceSlugs = new Set(profile.trial.readySourceSlugs);
  const chineseReadyPublishers = new Set(
    chineseHealthy
      .filter((source) => {
        const check = checksBySource.get(source.id);
        return (
          readySourceSlugs.has(source.slug) &&
          check?.latest_item_at &&
          reference.getTime() - Date.parse(check.latest_item_at) <=
            profile.trial.maximumReadySourceAgeDays * 86_400_000
        );
      })
      .map((source) => sourcePublisherKey(source.homepage_url, source.slug)),
  );
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
    observedDays >= targetDays &&
    automatedRuns.length > 0 &&
    chineseReadyPublishers.size >= profile.trial.minimumChineseReadySources &&
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
      start: validationStart.toISOString(),
      end: targetEnd.toISOString(),
      targetDays,
      observedDays,
      historyStart: historyStart.toISOString(),
      historyEnd: reference.toISOString(),
      historyLookbackDays: profile.trial.historyLookbackDays,
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
      chineseConfigured: chineseSources.length,
      chineseHealthy: chineseHealthy.length,
      chineseReadyPublishers: chineseReadyPublishers.size,
      minimumChineseReady: profile.trial.minimumChineseReadySources,
      chinaContentTargetPercent: profile.trial.targetChinaContentPercent,
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
      signals: publicIndustrySignalCount(
        signalRows,
        rules?.targetChinaContentPercent ?? 100,
        historyStart.toISOString(),
        evidenceEndExclusive.toISOString(),
      ),
      publishedEvents: eventsInWindow.length,
      multiSourceEvents: multiSourceEvents.length,
      multiSourceRatePercent: percent(multiSourceEvents.length, eventsInWindow.length),
      highPriorityEvents: highPriorityEvents.length,
      highPriorityEvidenceCoveragePercent: percent(evidenceReady.length, highPriorityEvents.length),
    },
    topCandidates: [...highPriorityEvents]
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

function publicIndustrySignalCount(
  signals: Array<{
    raw_meta_json: string;
    region: string;
    createdAt: string;
    publishedAt: string;
  }>,
  targetChinaPercent: number,
  windowStart: string,
  windowEndExclusive: string,
): number {
  const included = signals.filter(
    (signal) =>
      signal.publishedAt >= windowStart &&
      signal.publishedAt < windowEndExclusive &&
      scopeAssessmentFromSignal(signal)?.decision === "include",
  );
  const chinaCount = included.filter((signal) => signal.region === "CN").length;
  const globalCount = included.length - chinaCount;
  const maximumGlobal = Math.floor((chinaCount * (100 - targetChinaPercent)) / targetChinaPercent);
  return chinaCount + Math.min(globalCount, maximumGlobal);
}

function percent(numerator: number, denominator: number): number | null {
  return denominator > 0 ? Math.round((numerator / denominator) * 1_000) / 10 : null;
}
