import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { Kysely } from "kysely";
import { z } from "zod";
import type { JsonModelClient, ModelUsage } from "../ai/model-contract.js";
import type { ModelIdentity } from "../ai/provider.js";
import { parseJson } from "../db/repository.js";
import type { DatabaseSchema } from "../db/types.js";
import { sourcePublisherKey } from "../domain/source-identity.js";
import type { SignalMetrics } from "../domain/types.js";
import type { IndustryProfile } from "./profile.js";
import { assessStoredIndustryScope, loadIndustryRules } from "./rules.js";

const evidenceSchema = z
  .object({
    title: z.string().min(1).max(500),
    url: z.string().url(),
    source: z.string().min(1).max(120),
    sourceSlug: z.string().min(1).max(80),
    author: z.string().max(255).nullable(),
    publishedAt: z.string().datetime(),
    sourceRole: z.string().min(1).max(40),
    sourceTier: z.number().int().min(1).max(4),
  })
  .strict();

const viewpointSchema = z
  .object({
    id: z.string().regex(/^viewpoint-[a-f0-9]{16}$/),
    claim: z.string().min(8).max(240),
    summary: z.string().min(20).max(800),
    nature: z.enum(["opinion", "analysis", "forecast"]),
    stance: z.enum(["supportive", "cautionary", "critical", "mixed", "neutral"]),
    trackSlugs: z.array(z.string().min(2).max(100)).min(1).max(3),
    audiences: z.array(z.string().min(2).max(40)).min(1).max(8),
    whyItMatters: z.string().min(16).max(600),
    counterpoint: z.string().min(12).max(500),
    nextSignal: z.string().min(12).max(500),
    publishedAt: z.string().datetime(),
    sourceCount: z.number().int().min(1),
    authorCount: z.number().int().min(0),
    platformCount: z.number().int().min(1),
    engagement: z
      .object({
        likes: z.number().int().min(0),
        comments: z.number().int().min(0),
        reposts: z.number().int().min(0),
        tweets: z.number().int().min(0),
        measured: z.boolean(),
      })
      .strict(),
    heatScore: z.number().int().min(0).max(100),
    heatStatus: z.enum(["measured_hot", "multi_source_attention", "emerging"]),
    evidence: z.array(evidenceSchema).min(1).max(8),
  })
  .strict();

const runSchema = z
  .object({
    date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    status: z.enum(["success", "failed", "skipped"]),
    candidates: z.number().int().min(0).max(40),
    clusters: z.number().int().min(0).max(10),
    inputHash: z
      .string()
      .regex(/^[a-f0-9]{64}$/)
      .nullable(),
    usage: z
      .object({
        promptTokens: z.number().int().min(0),
        completionTokens: z.number().int().min(0),
        totalTokens: z.number().int().min(0),
      })
      .strict(),
    errorCode: z.string().min(1).max(80).optional(),
  })
  .strict();

export const IndustryViewpointReportSchema = z
  .object({
    schemaVersion: z.literal(1),
    profileSlug: z.string().min(2).max(80),
    generatedAt: z.string().datetime(),
    model: z
      .object({
        provider: z.string().min(2).max(40),
        name: z.string().min(2).max(120),
        status: z.enum(["success", "failed", "skipped"]),
        inputHash: z
          .string()
          .regex(/^[a-f0-9]{64}$/)
          .nullable(),
        usage: runSchema.shape.usage,
      })
      .strict(),
    runs: z.array(runSchema).max(14),
    viewpoints: z.array(viewpointSchema).max(10),
  })
  .strict();

export type IndustryViewpoint = z.infer<typeof viewpointSchema>;
export type IndustryViewpointReport = z.infer<typeof IndustryViewpointReportSchema>;

const modelOutputSchema = z
  .object({
    viewpoints: z
      .array(
        z
          .object({
            claim: z.string().trim().min(8).max(240),
            summary: z.string().trim().min(20).max(800),
            nature: z.enum(["opinion", "analysis", "forecast"]),
            stance: z.enum(["supportive", "cautionary", "critical", "mixed", "neutral"]),
            trackSlugs: z.array(z.string().min(2).max(100)).min(1).max(3),
            audiences: z.array(z.string().min(2).max(40)).min(1).max(8),
            whyItMatters: z.string().trim().min(16).max(600),
            counterpoint: z.string().trim().min(12).max(500),
            nextSignal: z.string().trim().min(12).max(500),
            evidenceUrls: z.array(z.string().url()).min(1).max(8),
          })
          .strict(),
      )
      .min(1)
      .max(3),
  })
  .strict();

interface Candidate {
  title: string;
  summary: string;
  url: string;
  author: string | null;
  publishedAt: string;
  source: string;
  sourceSlug: string;
  homepageUrl: string;
  sourceTier: number;
  sourceRole: string;
  sourceRegion: string;
  metrics: SignalMetrics;
  scopeDecision: "include" | "hold";
  scopeScore: number;
}

const DEFAULT_MAX_CANDIDATES = 16;
const HARD_MAX_CANDIDATES = 40;
const MAX_CANDIDATES_PER_SOURCE = 5;
const MAX_PROMPT_SUMMARY_CHARS = 480;

export interface AnalyzeViewpointsOptions {
  referenceAt?: string;
  maxCandidates?: number;
  outputPath?: string;
}

export async function analyzeIndustryViewpoints(
  db: Kysely<DatabaseSchema>,
  profile: IndustryProfile,
  rootDir: string,
  client: JsonModelClient,
  identity: ModelIdentity,
  options: AnalyzeViewpointsOptions = {},
): Promise<IndustryViewpointReport> {
  const referenceAt = options.referenceAt ?? new Date().toISOString();
  const outputPath =
    options.outputPath ?? join(rootDir, "industry-packs", profile.slug, "data", "viewpoints.json");
  const previous = await loadIndustryViewpoints(profile.slug, rootDir, outputPath);
  const candidates = await loadCandidates(
    db,
    profile,
    rootDir,
    referenceAt,
    Math.min(options.maxCandidates ?? DEFAULT_MAX_CANDIDATES, HARD_MAX_CANDIDATES),
  );
  const prompt = candidates.length ? buildPrompt(candidates, profile) : null;
  const inputHash = prompt ? createHash("sha256").update(prompt).digest("hex") : null;
  const usage: ModelUsage = { promptTokens: 0, completionTokens: 0, totalTokens: 0 };
  let status: "success" | "failed" | "skipped" = candidates.length ? "failed" : "skipped";
  let errorCode: string | undefined;
  let viewpoints: IndustryViewpoint[] = previous.viewpoints;

  if (prompt) {
    try {
      const completion = await client.completeJson({
        system: SYSTEM_PROMPT,
        user: prompt,
        maxTokens: 8_000,
        reasoningEffort: "low",
      });
      Object.assign(usage, completion.usage);
      const parsed = validateModelOutput(completion.value, candidates, profile);
      viewpoints = parsed.viewpoints.map((draft) => buildViewpoint(draft, candidates, referenceAt));
      status = "success";
    } catch (error) {
      errorCode = safeErrorCode(error);
    }
  }

  const run = {
    date: referenceAt.slice(0, 10),
    status,
    candidates: candidates.length,
    clusters: status === "success" ? viewpoints.length : 0,
    inputHash,
    usage,
    ...(errorCode ? { errorCode } : {}),
  } as const;
  const report = IndustryViewpointReportSchema.parse({
    schemaVersion: 1,
    profileSlug: profile.slug,
    generatedAt: referenceAt,
    model: {
      provider: identity.provider,
      name: identity.model,
      status,
      inputHash,
      usage,
    },
    runs: [...previous.runs.filter((item) => item.date !== run.date), run].slice(-14),
    viewpoints,
  });
  await mkdir(dirname(outputPath), { recursive: true });
  await writeFile(outputPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  return report;
}

export async function loadIndustryViewpoints(
  profileSlug: string,
  rootDir: string,
  explicitPath?: string,
): Promise<IndustryViewpointReport> {
  const path =
    explicitPath ?? join(rootDir, "industry-packs", profileSlug, "data", "viewpoints.json");
  try {
    return IndustryViewpointReportSchema.parse(JSON.parse(await readFile(path, "utf8")));
  } catch (error) {
    if (!isMissingFile(error)) throw error;
    return emptyReport(profileSlug);
  }
}

export async function resetIndustryViewpoints(profileSlug: string, rootDir: string): Promise<void> {
  const path = join(rootDir, "industry-packs", profileSlug, "data", "viewpoints.json");
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(emptyReport(profileSlug), null, 2)}\n`, "utf8");
}

export function reconcileIndustryViewpoints(
  report: IndustryViewpointReport,
  signalUrls: Iterable<string>,
): IndustryViewpointReport {
  const allowedUrls = new Set(signalUrls);
  const viewpoints = report.viewpoints.filter((viewpoint) =>
    viewpoint.evidence.every((evidence) => allowedUrls.has(evidence.url)),
  );
  if (allowedUrls.size > 0 && (report.model.status !== "success" || viewpoints.length > 0)) {
    return IndustryViewpointReportSchema.parse({ ...report, viewpoints });
  }
  return IndustryViewpointReportSchema.parse({
    ...report,
    model: {
      provider: report.model.provider,
      name: "not-run",
      status: "skipped",
      inputHash: null,
      usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
    },
    runs: [],
    viewpoints: [],
  });
}

function emptyReport(profileSlug: string): IndustryViewpointReport {
  return {
    schemaVersion: 1,
    profileSlug,
    generatedAt: new Date(0).toISOString(),
    model: {
      provider: "ark",
      name: "not-run",
      status: "skipped",
      inputHash: null,
      usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
    },
    runs: [],
    viewpoints: [],
  };
}

async function loadCandidates(
  db: Kysely<DatabaseSchema>,
  profile: IndustryProfile,
  rootDir: string,
  referenceAt: string,
  maxCandidates: number,
): Promise<Candidate[]> {
  const rules = loadIndustryRules(profile.slug, rootDir);
  if (!rules) return [];
  const start = new Date(
    Date.parse(referenceAt) - profile.trial.historyLookbackDays * 86_400_000,
  ).toISOString();
  const rows = await db
    .selectFrom("signals")
    .innerJoin("sources", "sources.id", "signals.source_id")
    .select([
      "signals.title",
      "signals.summary",
      "signals.canonical_url as url",
      "signals.author",
      "signals.published_at as publishedAt",
      "signals.tags_json",
      "signals.raw_meta_json",
      "signals.metrics_json as metricsJson",
      "sources.name as source",
      "sources.slug as sourceSlug",
      "sources.homepage_url as homepageUrl",
      "sources.tier as sourceTier",
      "sources.role as sourceRole",
      "sources.region as sourceRegion",
    ])
    .where("signals.published_at", ">=", start)
    .where("signals.published_at", "<=", referenceAt)
    .where("sources.role", "in", ["expert", "media", "research", "heat"])
    .orderBy("signals.published_at", "desc")
    .limit(Math.max(maxCandidates * 10, 100))
    .execute();
  const eligible: Candidate[] = [];
  const urls = new Set<string>();
  for (const row of rows) {
    const scope = assessStoredIndustryScope(row, { slug: row.sourceSlug }, rules);
    if (scope.decision === "exclude" || urls.has(row.url)) continue;
    urls.add(row.url);
    eligible.push({
      title: row.title,
      summary: row.summary,
      url: row.url,
      author: row.author,
      publishedAt: row.publishedAt,
      source: row.source,
      sourceSlug: row.sourceSlug,
      homepageUrl: row.homepageUrl,
      sourceTier: row.sourceTier,
      sourceRole: row.sourceRole,
      sourceRegion: row.sourceRegion,
      metrics: parseJson<SignalMetrics>(row.metricsJson, {}),
      scopeDecision: scope.decision,
      scopeScore: scope.score,
    });
  }

  eligible.sort(compareCandidates);
  const selected: Candidate[] = [];
  const perSource = new Map<string, number>();
  for (const candidate of eligible) {
    const sourceCount = perSource.get(candidate.sourceSlug) ?? 0;
    if (sourceCount >= MAX_CANDIDATES_PER_SOURCE) continue;
    selected.push(candidate);
    perSource.set(candidate.sourceSlug, sourceCount + 1);
    if (selected.length >= maxCandidates) break;
  }
  return selected;
}

function compareCandidates(left: Candidate, right: Candidate): number {
  const decision = scopeDecisionRank(right.scopeDecision) - scopeDecisionRank(left.scopeDecision);
  if (decision) return decision;
  if (right.scopeScore !== left.scopeScore) return right.scopeScore - left.scopeScore;
  const region = Number(right.sourceRegion === "CN") - Number(left.sourceRegion === "CN");
  if (region) return region;
  const role = sourceRoleRank(right.sourceRole) - sourceRoleRank(left.sourceRole);
  if (role) return role;
  if (left.sourceTier !== right.sourceTier) return left.sourceTier - right.sourceTier;
  return right.publishedAt.localeCompare(left.publishedAt) || left.url.localeCompare(right.url);
}

function scopeDecisionRank(value: Candidate["scopeDecision"]): number {
  return value === "include" ? 1 : 0;
}

function sourceRoleRank(value: string): number {
  return value === "expert" ? 4 : value === "research" ? 3 : value === "media" ? 2 : 1;
}

function buildPrompt(candidates: Candidate[], profile: IndustryProfile): string {
  return JSON.stringify({
    task: "从给定材料中识别、合并医疗健康数据要素领域值得关注的公开观点。观点不是已发生事实。",
    rules: [
      "只使用 inputs 中的信息，不补造观点、作者、数字、传播量或事实。",
      "合并表达同一核心主张的材料；明显不同或相反的主张分别输出。",
      "claim、summary、whyItMatters、counterpoint、nextSignal 使用简体中文。",
      "evidenceUrls 必须是 inputs.url 的子集。",
      "trackSlugs 必须来自 availableTracks.slug，audiences 必须来自 availableAudiences。",
      "不要判断观点是真实 Event，不要输出热度分数；热度由程序按真实传播证据计算。",
      "只输出直接涉及医疗健康数据治理、授权、流通、开发利用、标准互操作或支付保险数据应用的观点；纯 AI 编程、一般医院 IT 建设或未说明数据机制的国产化观点不要输出。",
      "最多输出 3 个最有决策价值且彼此不同的观点聚类，不为覆盖数量拆分相近观点。",
      "保持精炼：claim 不超过 60 字，summary 不超过 160 字，whyItMatters 不超过 120 字，counterpoint 和 nextSignal 各不超过 100 字。",
      "只输出 JSON object，不要输出 Markdown。",
    ],
    outputShape: {
      viewpoints: [
        {
          claim: "string",
          summary: "string",
          nature: "opinion | analysis | forecast",
          stance: "supportive | cautionary | critical | mixed | neutral",
          trackSlugs: ["string"],
          audiences: ["string"],
          whyItMatters: "string",
          counterpoint: "string",
          nextSignal: "string",
          evidenceUrls: ["https://..."],
        },
      ],
    },
    availableTracks: profile.tracks.map(({ slug, name, description }) => ({
      slug,
      name,
      description,
    })),
    availableAudiences: profile.audiences,
    inputs: candidates.map((candidate) => ({
      title: truncate(candidate.title, 300),
      summary: truncate(candidate.summary, MAX_PROMPT_SUMMARY_CHARS),
      url: candidate.url,
      author: candidate.author,
      publishedAt: candidate.publishedAt,
      source: candidate.source,
      sourceSlug: candidate.sourceSlug,
      sourceRole: candidate.sourceRole,
      sourceRegion: candidate.sourceRegion,
    })),
  });
}

const SYSTEM_PROMPT = [
  "你是医疗健康数据要素行业的观点编辑器。",
  "你的任务是区分观点、分析和预测，并把相同主张聚类。",
  "你不能把观点改写成已证实事实，也不能臆测传播热度。",
].join("\n");

function validateModelOutput(value: unknown, candidates: Candidate[], profile: IndustryProfile) {
  const parsed = modelOutputSchema.parse(value);
  const allowedUrls = new Set(candidates.map((candidate) => candidate.url));
  const allowedTracks = new Set(profile.tracks.map((track) => track.slug));
  const allowedAudiences = new Set(profile.audiences);
  for (const viewpoint of parsed.viewpoints) {
    if (![viewpoint.claim, viewpoint.summary, viewpoint.whyItMatters].every(hasChinese)) {
      throw new Error("non_chinese_viewpoint");
    }
    if (viewpoint.evidenceUrls.some((url) => !allowedUrls.has(url))) {
      throw new Error("unknown_evidence_url");
    }
    if (viewpoint.trackSlugs.some((slug) => !allowedTracks.has(slug))) {
      throw new Error("unknown_track_slug");
    }
    if (viewpoint.audiences.some((audience) => !allowedAudiences.has(audience))) {
      throw new Error("unknown_audience");
    }
  }
  const viewpoints = parsed.viewpoints.filter(isDirectIndustryViewpoint);
  if (viewpoints.length === 0) throw new Error("no_relevant_viewpoints");
  return { viewpoints };
}

function isDirectIndustryViewpoint(
  viewpoint: z.infer<typeof modelOutputSchema>["viewpoints"][number],
): boolean {
  const text = [
    viewpoint.claim,
    viewpoint.summary,
    viewpoint.whyItMatters,
    viewpoint.nextSignal,
  ].join(" ");
  return /数据要素|医疗(?:健康)?数据|健康数据|医保数据|医药数据|保险数据|理赔数据|数据(?:治理|授权|流通|资产|产品|空间|平台|中枢)|隐私计算|可信数据|互操作|事前授权|\bFHIR\b|\bHL7\b/i.test(
    text,
  );
}

function buildViewpoint(
  draft: z.infer<typeof modelOutputSchema>["viewpoints"][number],
  candidates: Candidate[],
  referenceAt: string,
): IndustryViewpoint {
  const byUrl = new Map(candidates.map((candidate) => [candidate.url, candidate]));
  const inputs = draft.evidenceUrls
    .map((url) => byUrl.get(url))
    .filter((candidate): candidate is Candidate => Boolean(candidate));
  const sources = new Set(
    inputs.map((input) => sourcePublisherKey(input.homepageUrl, input.sourceSlug)),
  );
  const authors = new Set(inputs.map((input) => input.author).filter(Boolean));
  const platforms = new Set(
    inputs.flatMap((input) => input.metrics.platforms ?? [platformFor(input.url)]),
  );
  const engagement = aggregateEngagement(inputs.map((input) => input.metrics));
  const heatScore = deterministicHeatScore(
    sources.size,
    authors.size,
    platforms.size,
    engagement,
    inputs.map((input) => input.publishedAt),
    referenceAt,
  );
  const heatStatus =
    engagement.measured && heatScore >= 60
      ? "measured_hot"
      : sources.size >= 2
        ? "multi_source_attention"
        : "emerging";
  const publishedAt = [...inputs].sort((left, right) =>
    right.publishedAt.localeCompare(left.publishedAt),
  )[0]?.publishedAt;
  const id = `viewpoint-${createHash("sha256")
    .update(`${draft.claim}\n${draft.evidenceUrls.slice().sort().join("\n")}`)
    .digest("hex")
    .slice(0, 16)}`;
  return viewpointSchema.parse({
    id,
    claim: draft.claim,
    summary: draft.summary,
    nature: draft.nature,
    stance: draft.stance,
    trackSlugs: draft.trackSlugs,
    audiences: draft.audiences,
    whyItMatters: draft.whyItMatters,
    counterpoint: draft.counterpoint,
    nextSignal: draft.nextSignal,
    publishedAt: publishedAt ?? referenceAt,
    sourceCount: sources.size,
    authorCount: authors.size,
    platformCount: Math.max(1, platforms.size),
    engagement,
    heatScore,
    heatStatus,
    evidence: inputs.map((input) => ({
      title: input.title,
      url: input.url,
      source: input.source,
      sourceSlug: input.sourceSlug,
      author: input.author,
      publishedAt: input.publishedAt,
      sourceRole: input.sourceRole,
      sourceTier: input.sourceTier,
    })),
  });
}

function aggregateEngagement(metrics: SignalMetrics[]) {
  const measured = metrics.some((item) =>
    [item.likes, item.comments, item.reposts, item.tweets].some((value) => Number.isFinite(value)),
  );
  return {
    likes: sum(metrics, "likes"),
    comments: sum(metrics, "comments"),
    reposts: sum(metrics, "reposts"),
    tweets: sum(metrics, "tweets"),
    measured,
  };
}

function deterministicHeatScore(
  sources: number,
  authors: number,
  platforms: number,
  engagement: ReturnType<typeof aggregateEngagement>,
  publishedDates: string[],
  referenceAt: string,
): number {
  const propagation = Math.min(35, Math.max(0, sources - 1) * 18 + Math.max(0, authors - 1) * 5);
  const breadth = Math.min(15, Math.max(0, platforms - 1) * 8);
  const volume = engagement.measured
    ? Math.min(
        35,
        Math.round(
          Math.log10(
            1 +
              engagement.likes +
              engagement.comments * 3 +
              engagement.reposts * 4 +
              engagement.tweets * 2,
          ) * 12,
        ),
      )
    : 0;
  const newest = Math.max(...publishedDates.map((date) => Date.parse(date)));
  const ageDays = Math.max(0, (Date.parse(referenceAt) - newest) / 86_400_000);
  const freshness = Math.max(0, Math.round(15 - ageDays / 2));
  return Math.max(0, Math.min(100, propagation + breadth + volume + freshness));
}

function sum(metrics: SignalMetrics[], key: "likes" | "comments" | "reposts" | "tweets") {
  return metrics.reduce(
    (total, item) => total + (Number.isFinite(item[key]) ? (item[key] ?? 0) : 0),
    0,
  );
}

function platformFor(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "website";
  }
}

function hasChinese(value: string): boolean {
  return /[\u3400-\u9fff]/.test(value);
}

function truncate(value: string, limit: number): string {
  return value.length <= limit ? value : `${value.slice(0, limit - 1).trimEnd()}…`;
}

function safeErrorCode(error: unknown): string {
  const candidate = error as { code?: unknown; message?: unknown };
  const value = typeof candidate.code === "string" ? candidate.code : candidate.message;
  return String(value ?? "viewpoint_analysis_failed")
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "_")
    .slice(0, 80);
}

function isMissingFile(error: unknown): boolean {
  return (error as NodeJS.ErrnoException).code === "ENOENT";
}
