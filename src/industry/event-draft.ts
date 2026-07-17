import { parseJson } from "../db/repository.js";
import type { SignalRow, SourceRow } from "../db/types.js";
import { assessStoredIndustryScope, type IndustryRules } from "./rules.js";

export interface DeterministicIndustryDraft {
  factSummary: string;
  summary: string;
  technicalInsight: string;
  industryInsight: string;
  futureOutlook: string;
  businessValue: string;
  company: string;
  category: string;
  keywords: string[];
  trackSlugs: string[];
}

export function deterministicIndustryDraft(
  signal: SignalRow,
  source: SourceRow,
  rules: IndustryRules,
): DeterministicIndustryDraft | null {
  if (!signal.language.toLowerCase().startsWith("zh")) return null;
  const scope = assessStoredIndustryScope(signal, source, rules);
  if (scope.decision !== "include") return null;
  const text = normalize(
    [signal.title, signal.summary, ...parseJson<string[]>(signal.tags_json, [])].join(" "),
  );
  const rankedTracks = rules.tracks
    .map((track, index) => ({
      track,
      index,
      score: track.terms.filter((term) => text.includes(normalize(term))).length,
    }))
    .filter((item) => item.score > 0)
    .sort((left, right) => right.score - left.score || left.index - right.index)
    .slice(0, 3);
  const primary = rankedTracks[0]?.track;
  if (!primary) return null;
  const evidenceSummary = clip(clean(signal.summary) || clean(signal.title), 520);
  const factSummary = clip(`据${source.name}公开材料：${evidenceSummary}`, 600);
  const keywords = [
    ...scope.matchedStrong,
    ...scope.matchedContext,
    ...scope.matchedActions,
    ...scope.matchedEntities,
  ];
  return {
    factSummary,
    summary: clip(evidenceSummary, 1_200),
    technicalInsight: primary.technicalInsight,
    industryInsight: primary.industryInsight,
    futureOutlook: primary.futureOutlook,
    businessValue: primary.businessValue,
    company: scope.matchedEntities[0] ?? source.name,
    category: primary.slug,
    keywords: [...new Set(keywords)].slice(0, 8),
    trackSlugs: rankedTracks.map((item) => item.track.slug),
  };
}

function clean(value: string): string {
  return value
    .replace(/<[^>]*>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function clip(value: string, limit: number): string {
  return value.length <= limit ? value : `${value.slice(0, limit - 1).trimEnd()}…`;
}

function normalize(value: string): string {
  return value.normalize("NFKC").toLowerCase().replace(/\s+/g, " ").trim();
}
