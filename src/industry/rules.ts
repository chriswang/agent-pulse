import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import { parseJson } from "../db/repository.js";
import type { SignalRow, SourceRow } from "../db/types.js";
import type { CollectedSignal, SourceDescriptor } from "../domain/types.js";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

const weightedTermsSchema = z
  .object({
    terms: z.array(z.string().min(2).max(80)).min(1).max(200),
    weight: z.number().int().min(1).max(100),
    cap: z.number().int().min(1).max(100),
  })
  .strict();

export const IndustryRulesSchema = z
  .object({
    schemaVersion: z.literal(1),
    profileSlug: z.string().regex(/^[a-z0-9][a-z0-9-]{1,79}$/),
    contentLocale: z.literal("zh-CN"),
    baselineDays: z.number().int().min(7).max(365),
    targetChinaContentPercent: z.number().int().min(50).max(100),
    minimumChineseReadySources: z.number().int().min(1).max(30),
    relevance: z
      .object({
        includeThreshold: z.number().int().min(1).max(100),
        holdThreshold: z.number().int().min(0).max(99),
        strong: weightedTermsSchema,
        context: weightedTermsSchema,
        action: weightedTermsSchema,
        exclusions: z.array(z.string().min(2).max(80)).max(100),
        sourceBoosts: z.record(z.string(), z.number().int().min(0).max(50)),
      })
      .strict(),
    entities: z
      .array(
        z
          .object({
            canonical: z.string().min(2).max(120),
            aliases: z.array(z.string().min(2).max(120)).min(1).max(20),
            weight: z.number().int().min(1).max(50),
          })
          .strict(),
      )
      .max(100),
    publication: z
      .object({
        minimumRelevanceScore: z.number().int().min(1).max(100),
        highPriorityConfidence: z.number().int().min(1).max(100),
        highPriorityImpact: z.number().int().min(1).max(100),
        highPriorityValue: z.number().int().min(1).max(100),
      })
      .strict(),
  })
  .strict()
  .superRefine((rules, context) => {
    if (rules.relevance.holdThreshold >= rules.relevance.includeThreshold) {
      context.addIssue({
        code: "custom",
        path: ["relevance", "holdThreshold"],
        message: "holdThreshold must be lower than includeThreshold",
      });
    }
  });

export type IndustryRules = z.infer<typeof IndustryRulesSchema>;
export type IndustryScopeDecision = "include" | "hold" | "exclude";

export interface IndustryScopeAssessment {
  profileSlug: string;
  rulesVersion: 1;
  decision: IndustryScopeDecision;
  score: number;
  matchedStrong: string[];
  matchedContext: string[];
  matchedActions: string[];
  matchedEntities: string[];
  matchedExclusions: string[];
}

export interface IndustryPolicyContext {
  industryProfileSlug?: string;
  rootDir?: string;
}

export function loadIndustryRules(
  slug = process.env.INDUSTRY_PROFILE,
  rootDir = repositoryRoot,
): IndustryRules | null {
  if (!slug) return null;
  if (!/^[a-z0-9][a-z0-9-]{1,79}$/.test(slug)) throw new Error("invalid_industry_profile_slug");
  const path = join(rootDir, "industry-packs", slug, "rules.json");
  return IndustryRulesSchema.parse(JSON.parse(readFileSync(path, "utf8")));
}

export function assessIndustryScope(
  signal: Pick<CollectedSignal, "title" | "summary" | "tags">,
  source: Pick<SourceDescriptor, "slug">,
  rules: IndustryRules,
): IndustryScopeAssessment {
  const text = normalize([signal.title, signal.summary, ...signal.tags].join(" "));
  const matchedStrong = matches(text, rules.relevance.strong.terms);
  const matchedContext = matches(text, rules.relevance.context.terms);
  const matchedActions = matches(text, rules.relevance.action.terms);
  const matchedExclusions = matches(text, rules.relevance.exclusions);
  const matchedEntities = rules.entities
    .filter((entity) => entity.aliases.some((alias) => text.includes(normalize(alias))))
    .map((entity) => entity.canonical);
  const entityScore = rules.entities
    .filter((entity) => matchedEntities.includes(entity.canonical))
    .reduce((sum, entity) => sum + entity.weight, 0);
  const score = clamp(
    boundedScore(matchedStrong.length, rules.relevance.strong) +
      boundedScore(matchedContext.length, rules.relevance.context) +
      boundedScore(matchedActions.length, rules.relevance.action) +
      Math.min(40, entityScore) +
      (rules.relevance.sourceBoosts[source.slug] ?? 0) -
      (matchedExclusions.length > 0 && matchedStrong.length === 0 ? 60 : 0),
  );
  const decision: IndustryScopeDecision =
    score >= rules.relevance.includeThreshold
      ? "include"
      : score >= rules.relevance.holdThreshold
        ? "hold"
        : "exclude";
  return {
    profileSlug: rules.profileSlug,
    rulesVersion: 1,
    decision,
    score,
    matchedStrong,
    matchedContext,
    matchedActions,
    matchedEntities,
    matchedExclusions,
  };
}

export function scopeAssessmentFromSignal(signal: Pick<SignalRow, "raw_meta_json">) {
  const meta = parseJson<{ industryScope?: unknown }>(signal.raw_meta_json, {});
  const parsed = IndustryScopeAssessmentSchema.safeParse(meta.industryScope);
  return parsed.success ? parsed.data : null;
}

export function assessStoredIndustryScope(
  signal: Pick<SignalRow, "title" | "summary" | "tags_json" | "raw_meta_json">,
  source: Pick<SourceRow, "slug">,
  rules: IndustryRules,
): IndustryScopeAssessment {
  const stored = scopeAssessmentFromSignal(signal);
  if (stored?.profileSlug === rules.profileSlug) return stored;
  return assessIndustryScope(
    {
      title: signal.title,
      summary: signal.summary,
      tags: parseJson<string[]>(signal.tags_json, []),
    },
    { slug: source.slug },
    rules,
  );
}

export function industryEventabilityScore(
  signal: SignalRow,
  source: SourceRow | undefined,
  rules: IndustryRules,
): number {
  if (!source) return 0;
  const scope = assessStoredIndustryScope(signal, source, rules);
  if (scope.decision !== "include") {
    return 0;
  }
  const authority = source.tier === 1 ? 20 : source.tier === 2 ? 10 : 4;
  const original = source.role === "policy" || source.role === "primary" ? 15 : 8;
  const action = Math.min(12, scope.matchedActions.length * 4);
  return clamp(scope.score * 0.6 + authority + original + action);
}

export function initialIndustryImpactScore(
  signal: SignalRow,
  source: SourceRow | undefined,
  rules: IndustryRules,
): number {
  if (!source) return 0;
  const scope = assessStoredIndustryScope(signal, source, rules);
  const original = source.role === "policy" || source.role === "primary" ? 20 : 10;
  const authority = source.tier === 1 ? 15 : source.tier === 2 ? 7 : 2;
  const action = Math.min(10, scope.matchedActions.length * 3);
  return clamp(scope.score * 0.55 + original + authority + action);
}

const IndustryScopeAssessmentSchema = z
  .object({
    profileSlug: z.string(),
    rulesVersion: z.literal(1),
    decision: z.enum(["include", "hold", "exclude"]),
    score: z.number().min(0).max(100),
    matchedStrong: z.array(z.string()),
    matchedContext: z.array(z.string()),
    matchedActions: z.array(z.string()),
    matchedEntities: z.array(z.string()),
    matchedExclusions: z.array(z.string()),
  })
  .strict();

function boundedScore(count: number, config: { weight: number; cap: number }): number {
  return Math.min(config.cap, count * config.weight);
}

function matches(text: string, terms: string[]): string[] {
  return terms.filter((term) => text.includes(normalize(term)));
}

function normalize(value: string): string {
  return value.normalize("NFKC").toLowerCase().replace(/\s+/g, " ").trim();
}

function clamp(value: number): number {
  return Math.max(0, Math.min(100, Math.round(value)));
}
