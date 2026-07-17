import { sourcePublisherKey } from "../domain/source-identity.js";
import type { IndustryProfile } from "./profile.js";

export interface SourceGateAuditResult {
  slug: string;
  status: string;
  latestItemAt: string | null;
}

export interface SourceGateAuditReport {
  finishedAt: string;
  results: SourceGateAuditResult[];
}

export interface IndustrySourceGateResult {
  pass: boolean;
  referenceAt: string;
  maximumAgeDays: number;
  minimumChinesePublishers: number;
  minimumInternationalPublishers: number;
  chineseReadyPublishers: number;
  internationalReadyPublishers: number;
  chineseReadySlugs: string[];
  internationalReadySlugs: string[];
  rejectedReadySlugs: Array<{ slug: string; reason: string }>;
}

export function evaluateIndustrySourceGate(
  profile: IndustryProfile,
  report: SourceGateAuditReport,
): IndustrySourceGateResult {
  const reference = new Date(report.finishedAt);
  if (!Number.isFinite(reference.getTime())) throw new Error("invalid_source_audit_finished_at");
  const resultsBySlug = new Map(report.results.map((result) => [result.slug, result]));
  const configuredBySlug = new Map(profile.sources.map((source) => [source.slug, source]));
  const maximumAgeMs = profile.trial.maximumReadySourceAgeDays * 86_400_000;
  const ready = profile.trial.readySourceSlugs.flatMap((slug) => {
    const source = configuredBySlug.get(slug);
    const result = resultsBySlug.get(slug);
    if (!source) return [];
    const reason = sourceGateRejection(result, reference.getTime(), maximumAgeMs);
    return [{ source, reason }];
  });
  const chineseReady = ready.filter((item) => item.source.region === "CN" && !item.reason);
  const internationalReady = ready.filter((item) => item.source.region !== "CN" && !item.reason);
  const chinesePublishers = new Set(
    chineseReady.map(({ source }) => sourcePublisherKey(source.homepageUrl, source.slug)),
  );
  const internationalPublishers = new Set(
    internationalReady.map(({ source }) => sourcePublisherKey(source.homepageUrl, source.slug)),
  );
  const minimumInternationalPublishers = Math.ceil(
    (profile.trial.minimumChineseReadySources * (100 - profile.trial.targetChinaContentPercent)) /
      profile.trial.targetChinaContentPercent,
  );

  return {
    pass:
      chinesePublishers.size >= profile.trial.minimumChineseReadySources &&
      internationalPublishers.size >= minimumInternationalPublishers,
    referenceAt: reference.toISOString(),
    maximumAgeDays: profile.trial.maximumReadySourceAgeDays,
    minimumChinesePublishers: profile.trial.minimumChineseReadySources,
    minimumInternationalPublishers,
    chineseReadyPublishers: chinesePublishers.size,
    internationalReadyPublishers: internationalPublishers.size,
    chineseReadySlugs: chineseReady.map(({ source }) => source.slug),
    internationalReadySlugs: internationalReady.map(({ source }) => source.slug),
    rejectedReadySlugs: ready
      .filter((item): item is typeof item & { reason: string } => Boolean(item.reason))
      .map(({ source, reason }) => ({ slug: source.slug, reason })),
  };
}

function sourceGateRejection(
  result: SourceGateAuditResult | undefined,
  referenceMs: number,
  maximumAgeMs: number,
): string | null {
  if (!result) return "missing_audit";
  if (result.status !== "healthy") return `status_${result.status}`;
  if (!result.latestItemAt) return "missing_latest_item";
  const latestMs = Date.parse(result.latestItemAt);
  if (!Number.isFinite(latestMs)) return "invalid_latest_item";
  if (referenceMs - latestMs > maximumAgeMs) return "content_stale";
  return null;
}
