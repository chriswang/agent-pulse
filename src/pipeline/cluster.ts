import { randomUUID } from "node:crypto";
import type { Kysely } from "kysely";
import { now, parseJson, Repository } from "../db/repository.js";
import type { DatabaseSchema, EventRow, SignalRow, SourceRow } from "../db/types.js";
import {
  belongsToEvent,
  eventFingerprint,
  titleSimilarity,
  titleTokens,
} from "../domain/clustering.js";
import { scoreEvent } from "../domain/scoring.js";
import { sourcePublisherKey } from "../domain/source-identity.js";
import type { SignalMetrics } from "../domain/types.js";
import { slugify } from "../domain/url.js";
import { deterministicIndustryDraft } from "../industry/event-draft.js";
import {
  assessStoredIndustryScope,
  type IndustryPolicyContext,
  type IndustryRules,
  industryEventabilityScore,
  initialIndustryImpactScore,
  loadIndustryRules,
} from "../industry/rules.js";

export async function clusterSignals(
  db: Kysely<DatabaseSchema>,
  context: IndustryPolicyContext = {},
): Promise<{ created: number; attached: number; deferred: number }> {
  const repository = new Repository(db);
  const industryRules = loadIndustryRules(context.industryProfileSlug, context.rootDir);
  const [signals, sources] = await Promise.all([
    repository.listUnclusteredSignals(),
    repository.listSources(),
  ]);
  const sourcesById = new Map(sources.map((source) => [source.id, source]));
  signals.sort(
    (left, right) =>
      effectiveEventabilityScore(right, sourcesById.get(right.source_id), industryRules) -
        effectiveEventabilityScore(left, sourcesById.get(left.source_id), industryRules) ||
      right.published_at.localeCompare(left.published_at),
  );
  const [events, tracks] = await Promise.all([repository.listEvents(), repository.listTracks()]);
  const trackIds = new Map(tracks.map((track) => [track.slug, track.id]));
  let created = 0;
  let attached = 0;
  let deferred = 0;

  for (const signal of signals) {
    // Skip signals with empty or whitespace-only titles — they produce unusable events.
    if (!signal.title?.trim()) continue;
    const source = sourcesById.get(signal.source_id);
    const industryScope =
      industryRules && source ? assessStoredIndustryScope(signal, source, industryRules) : null;
    if (industryScope && industryScope.decision !== "include") {
      await repository.deferSignal(
        signal.id,
        industryScope.decision === "hold" ? "industry_scope_hold" : "industry_scope_exclude",
        industryScope.score,
        {
          profileSlug: industryScope.profileSlug,
          matchedStrong: industryScope.matchedStrong,
          matchedContext: industryScope.matchedContext,
          matchedActions: industryScope.matchedActions,
          matchedEntities: industryScope.matchedEntities,
          matchedExclusions: industryScope.matchedExclusions,
        },
      );
      deferred += 1;
      continue;
    }
    if (source?.lifecycle_status === "shadow") {
      await repository.deferSignal(
        signal.id,
        "shadow_observation",
        effectiveEventabilityScore(signal, source, industryRules),
        {
          sourceSlug: source.slug,
          latestLifecycle: source.lifecycle_status,
          releaseCondition: "source_activation_after_20_healthy_checks_and_7_days",
        },
      );
      deferred += 1;
      continue;
    }
    let eventCreated = false;
    const industryDraft =
      industryRules && source ? deterministicIndustryDraft(signal, source, industryRules) : null;
    let event = events.find((candidate) =>
      belongsToEvent(
        { title: signal.title, publishedAt: signal.published_at },
        { title: candidate.title, happenedAt: candidate.happened_at },
      ),
    );
    if (!event) {
      const score = effectiveEventabilityScore(signal, source, industryRules);
      if (score < 70) {
        await repository.deferSignal(signal.id, "insufficient_eventability", score, {
          sourceSlug: source?.slug ?? null,
          sourceTier: source?.tier ?? null,
          sourceRole: source?.role ?? null,
          sourceCategory: source?.source_category ?? null,
        });
        deferred += 1;
        continue;
      }
      const timestamp = now();
      const baseSlug = uniqueSlug(signal.title, timestamp);
      // Prevent duplicate slugs by appending a short random suffix when needed.
      const existing = events.find((candidate) => candidate.slug === baseSlug);
      const slug = existing ? `${baseSlug}-${randomUUID().slice(0, 6)}` : baseSlug;
      event = {
        id: randomUUID(),
        slug,
        title: signal.title,
        fact_summary: industryDraft?.factSummary ?? (signal.summary || signal.title),
        summary: industryDraft?.summary ?? (signal.summary || signal.title),
        technical_insight:
          industryDraft?.technicalInsight ?? "待编辑：这项变化对能力、成本或工程路线意味着什么？",
        industry_insight:
          industryDraft?.industryInsight ?? "待编辑：这项变化会如何影响竞争结构与产业分工？",
        future_outlook: industryDraft?.futureOutlook ?? "待编辑：接下来要观察哪些可验证信号？",
        business_value:
          industryDraft?.businessValue ?? "待编辑：CEO、投资负责人或业务负责人应采取什么动作？",
        category: industryDraft?.category ?? signal.category,
        company:
          industryDraft?.company ?? industryScope?.matchedEntities[0] ?? inferCompany(signal.title),
        keywords_json: JSON.stringify(
          industryDraft?.keywords ?? [...titleTokens(signal.title)].slice(0, 8),
        ),
        confidence_score: 0,
        heat_score: 0,
        impact_score: industryRules
          ? initialIndustryImpactScore(signal, source, industryRules)
          : 55,
        value_score: 0,
        score_factors_json: "{}",
        status: "review",
        featured: 0,
        manual_override: 0,
        happened_at: signal.published_at,
        published_at: null,
        created_at: timestamp,
        updated_at: timestamp,
      } satisfies EventRow;
      await repository.insertEvent(event);
      events.push(event);
      created += 1;
      eventCreated = true;
    } else {
      attached += 1;
    }
    await repository.attachSignal(
      event.id,
      signal.id,
      "supporting",
      Math.round(titleSimilarity(signal.title, event.title) * 100),
    );
    if (eventCreated && industryDraft) {
      for (const [index, slug] of industryDraft.trackSlugs.entries()) {
        const trackId = trackIds.get(slug);
        if (!trackId) continue;
        await db
          .insertInto("event_tracks")
          .values({
            event_id: event.id,
            track_id: trackId,
            node_role: "supporting",
            narrative: industryDraft.industryInsight,
            stage: "evidence",
            order_index: index,
            created_at: now(),
          })
          .onConflict((conflict) => conflict.columns(["event_id", "track_id"]).doNothing())
          .execute();
      }
    }
    if (eventCreated) {
      const candidates = await repository.listDeferredSignalsNear(event.happened_at);
      for (const candidate of candidates) {
        if (
          !belongsToEvent(
            { title: candidate.title, publishedAt: candidate.published_at },
            { title: event.title, happenedAt: event.happened_at },
          )
        )
          continue;
        await repository.attachSignal(
          event.id,
          candidate.id,
          "supporting",
          Math.round(titleSimilarity(candidate.title, event.title) * 100),
        );
        await repository.clearSignalTriage(candidate.id);
        attached += 1;
      }
    }
    await rescoreEvent(repository, event);
  }
  return { created, attached, deferred };
}

export function eventabilityScore(signal: SignalRow, source?: SourceRow): number {
  if (!source || source.role === "aggregator" || source.source_category === "aggregator") return 0;
  const researchSource = source.role === "research" || source.source_category === "research-eval";
  const decisionRelevantResearch = researchSource && isDecisionRelevantResearch(signal);
  let score = source.tier === 1 ? 25 : source.tier === 2 ? 10 : 0;
  if (source.role === "primary" || source.role === "policy") score += 20;
  else if (source.role === "research") score += 10;
  if (
    [
      "frontier-lab",
      "china-lab",
      "company",
      "open-source",
      "agent-devtool",
      "policy",
      "infra-chip-cloud",
      "research-eval",
    ].includes(source.source_category)
  )
    score += 15;
  if (decisionRelevantResearch) score += 25;
  if (
    /\breleas(?:e|ed|es|ing)|\blaunch(?:es|ed|ing)?|\bannounc(?:e|ed|es|ing)|\bintroduc(?:e|ed|es|ing)|\bavailable\b|availability|general(?:ly)? available|\bpreview(?:ing|ed)?\b|\badds?\b|now supports?|support for|open[- ]source|funding|acqui(?:re|red|sition)|regulation|policy|发布|推出|上线|可用|预览|新增|支持|开源|融资|并购|收购|监管|政策/i.test(
      signal.title,
    )
  )
    score += 20;
  if (eventFingerprint(signal.title)) score += 20;
  const quality = parseJson<{ quality?: { score?: number } }>(signal.raw_meta_json, {}).quality
    ?.score;
  if (typeof quality === "number" && quality >= 70) score += 10;
  if (researchSource && !decisionRelevantResearch) return Math.min(65, score);
  return Math.min(100, score);
}

function effectiveEventabilityScore(
  signal: SignalRow,
  source: SourceRow | undefined,
  industryRules: IndustryRules | null,
): number {
  return industryRules
    ? industryEventabilityScore(signal, source, industryRules)
    : eventabilityScore(signal, source);
}

export function isDecisionRelevantResearch(signal: SignalRow): boolean {
  const content = `${signal.title} ${signal.summary}`;
  const hasResearchContribution =
    /benchmark|dataset|framework|method|mechanism|architecture|evaluation|empirical|study|analysis|taxonomy|基准|数据集|框架|方法|机制|架构|评测|实证|研究/i.test(
      content,
    );
  const hasDecisionDomain =
    /large language model|\bLLMs?\b|agent|reasoning|long[- ]context|coding|code model|multimodal|vision[- ]language|training|inference|alignment|robot|memory|context compression|tool use|causal|智能体|推理|长上下文|编码|多模态|训练|推理|对齐|机器人|记忆|上下文压缩|工具使用|因果/i.test(
      content,
    );
  return signal.summary.trim().length >= 160 && hasResearchContribution && hasDecisionDomain;
}

export async function rescoreEvent(repository: Repository, event: EventRow): Promise<void> {
  if (event.manual_override === 1) return;
  const context = await repository.eventScoringContext(event.id);
  const ageHours = Math.max(0, (Date.now() - new Date(event.happened_at).getTime()) / 3_600_000);
  const score = scoreEvent({
    authorityScores: context.map((item) => item.authorityScore),
    primaryEvidenceCount: context.filter(
      (item) =>
        item.tier === 1 && item.role !== "aggregator" && item.sourceCategory !== "aggregator",
    ).length,
    independentSourceCount: new Set(
      context.map((item) => sourcePublisherKey(item.homepageUrl, item.sourceId)),
    ).size,
    metrics: context.map((item) => item.metrics as SignalMetrics),
    ageHours,
    impactHint: event.impact_score,
  });
  await repository.updateEvent(event.id, {
    confidence_score: score.confidence,
    heat_score: score.heat,
    impact_score: score.impact,
    value_score: score.value,
    score_factors_json: JSON.stringify(score.factors),
  });
}

function uniqueSlug(title: string, timestamp: string): string {
  return `${slugify(title)}-${timestamp.slice(0, 10)}`.slice(0, 250);
}

function inferCompany(title: string): string {
  const companies = [
    "OpenAI",
    "Anthropic",
    "Google",
    "Meta",
    "Microsoft",
    "Apple",
    "DeepSeek",
    "Qwen",
    "Kimi",
    "MiniMax",
    "智谱",
    "阿里",
    "腾讯",
    "字节",
  ];
  return (
    companies.find((company) => title.toLowerCase().includes(company.toLowerCase())) ?? "industry"
  );
}
