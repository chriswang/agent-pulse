import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { loadConfig } from "../src/config/env.js";
import { createDatabase } from "../src/db/database.js";
import { migrateToLatest } from "../src/db/migrate.js";
import { Repository } from "../src/db/repository.js";
import { seedDatabase } from "../src/db/seed.js";
import { buildIndustryPilotReport, selectDecisionTopItems } from "../src/industry/pilot-report.js";
import {
  IndustryProfileSchema,
  industrySources,
  loadIndustryProfile,
} from "../src/industry/profile.js";
import { assessIndustryScope, loadIndustryRules } from "../src/industry/rules.js";
import { exportStaticSite, selectIndustrySignals } from "../src/pipeline/export.js";
import { validatePublicSite } from "../src/pipeline/public-site-integrity.js";

const profileSlug = "medical-health-data-elements";

describe("medical health data elements industry profile", () => {
  it("deduplicates exact fact and viewpoint evidence without dropping broader synthesis", () => {
    const sharedUrl = "https://example.com/shared-evidence";
    const common = {
      summary: "summary",
      happenedAt: "2026-07-18T00:00:00.000Z",
      sourceCount: 1,
      rankingReason: "reason",
      href: "#item",
    } as const;
    const selected = selectDecisionTopItems(
      [
        {
          ...common,
          id: "fact-shared",
          kind: "fact",
          title: "Shared fact",
          priorityScore: 67,
          evidenceStatus: "primary_only",
          evidenceUrls: [sharedUrl],
        },
        {
          ...common,
          id: "viewpoint-shared",
          kind: "viewpoint",
          title: "Shared viewpoint",
          priorityScore: 40,
          evidenceStatus: "viewpoint_evidence",
          evidenceUrls: [sharedUrl],
        },
        {
          ...common,
          id: "viewpoint-synthesis",
          kind: "viewpoint",
          title: "Broader synthesis",
          priorityScore: 41,
          evidenceStatus: "viewpoint_evidence",
          evidenceUrls: [sharedUrl, "https://example.com/second-evidence"],
        },
      ],
      10,
    );

    expect(selected.map((entry) => entry.id)).toEqual(["fact-shared", "viewpoint-synthesis"]);
  });

  it("keeps a China-first governed source pack isolated from the core profile", () => {
    const profile = requiredProfile();
    expect(profile.sources).toHaveLength(30);
    expect(profile.tracks).toHaveLength(6);
    expect(profile.model).toEqual({
      provider: "ark",
      baseUrl: "https://ark.cn-beijing.volces.com/api/coding/v3",
      name: "glm-5.2",
    });
    const sources = industrySources(profile);
    expect(sources.filter((source) => source.adapter !== "manual").length).toBeGreaterThanOrEqual(
      20,
    );
    expect(new Set(sources.map((source) => source.slug)).size).toBe(sources.length);
    expect(profile.sources.filter((source) => source.region === "CN")).toHaveLength(24);
    expect(profile.sources.filter((source) => source.region !== "CN")).toHaveLength(6);
    expect(profile.trial).toMatchObject({
      phase: "pilot",
      baselineDays: 30,
      historyLookbackDays: 30,
      baselineStartDate: "2026-07-18",
      validationStartDate: "2026-07-18",
      durationDays: 7,
      targetChinaContentPercent: 80,
      minimumChineseReadySources: 12,
      maximumReadySourceAgeDays: 90,
    });
    expect(profile.trial.readySourceSlugs).toHaveLength(21);
    expect(sources.filter((source) => source.enabled)).toHaveLength(21);
    expect(sources.filter((source) => source.enabled && source.region === "CN")).toHaveLength(18);
    expect(
      profile.sources.filter(
        (source) =>
          source.region === "CN" && ["expert", "media", "research", "heat"].includes(source.role),
      ).length,
    ).toBeGreaterThanOrEqual(4);
  });

  it("rejects duplicate source slugs", () => {
    const profile = requiredProfile();
    const duplicate = structuredClone(profile);
    const [first, second] = duplicate.sources;
    if (!first || !second) throw new Error("profile_fixture_requires_two_sources");
    second.slug = first.slug;
    expect(() => IndustryProfileSchema.parse(duplicate)).toThrow(/Duplicate slug/);
  });

  it("rejects manual sources in the pilot-ready collection set", () => {
    const profile = structuredClone(requiredProfile());
    const source = profile.sources[0];
    if (!source) throw new Error("profile_fixture_requires_source");
    source.adapter = "manual";
    source.acquisition = "manual";
    source.maintenanceStatus = "manual";
    profile.trial.readySourceSlugs = [source.slug];
    expect(() => IndustryProfileSchema.parse(profile)).toThrow(/must be automated/);
  });

  it("rejects repository snapshot paths that escape the checkout", () => {
    expect(() =>
      loadConfig({
        NODE_ENV: "test",
        DATABASE_URL: "sqlite::memory:",
        REPOSITORY_SNAPSHOT_PATH: "../private/snapshot.json",
      }),
    ).toThrow(/must stay inside the repository/);
  });

  it("keeps translated global material inside the international content quota", () => {
    const rules = loadIndustryRules(profileSlug);
    if (!rules) throw new Error("missing_industry_rules");
    const input = {
      title: "医疗健康数据要素授权运营行业分析",
      summary: "医疗健康数据流通、医院应用和保险服务需要可验证的授权运营闭环。",
      tags: ["医疗健康数据", "授权运营"],
    };
    const scope = assessIndustryScope(input, { slug: "hl7-blog" }, rules);
    expect(scope.decision).toBe("include");
    const makeSignals = (sourceRegion: "CN" | "GLOBAL", count: number) =>
      Array.from({ length: count }, (_, index) => ({
        id: `${sourceRegion}-${index}`,
        rawMetaJson: JSON.stringify({ industryScope: scope }),
        sourceRegion,
        language: "zh-CN",
        publishedAt: `2026-07-${String(10 + index).padStart(2, "0")}T00:00:00.000Z`,
      }));
    const [outsideWindow] = makeSignals("CN", 1);
    if (!outsideWindow) throw new Error("missing_window_fixture");

    const selected = selectIndustrySignals(
      [
        ...makeSignals("CN", 8),
        ...makeSignals("GLOBAL", 8),
        {
          ...outsideWindow,
          id: "CN-outside-window",
          publishedAt: "2026-05-01T00:00:00.000Z",
        },
      ],
      rules,
      {
        windowStart: "2026-06-18T00:00:00.000Z",
        windowEndExclusive: "2026-07-18T00:00:00.001Z",
      },
    );

    expect(selected).toHaveLength(10);
    expect(selected.filter((signal) => signal.sourceRegion === "GLOBAL")).toHaveLength(2);
  });

  it("seeds only the isolated industry catalog and starts with honest empty intelligence", async () => {
    const config = loadConfig({ NODE_ENV: "test", DATABASE_URL: "sqlite::memory:" });
    const db = createDatabase(config);
    try {
      await migrateToLatest(db, config);
      await seedDatabase(db, { industryProfileSlug: profileSlug, rootDir: config.rootDir });
      const [sourceCount, trackCount, eventCount, actorCount] = await Promise.all([
        count(db, "sources"),
        count(db, "tracks"),
        count(db, "events"),
        count(db, "actors"),
      ]);
      expect(sourceCount).toBe(30);
      expect(trackCount).toBe(6);
      expect(eventCount).toBe(0);
      expect(actorCount).toBe(0);

      const report = await buildIndustryPilotReport(
        db,
        requiredProfile(config.rootDir),
        config.rootDir,
        "2026-07-18T00:00:00.000Z",
      );
      expect(report).toMatchObject({
        readiness: "collecting",
        window: {
          start: "2026-07-18T00:00:00.000Z",
          end: "2026-07-24T00:00:00.000Z",
          targetDays: 7,
          observedDays: 0,
          historyStart: "2026-06-18T00:00:00.000Z",
          historyEnd: "2026-07-18T00:00:00.000Z",
          historyLookbackDays: 30,
        },
        sources: {
          configured: 30,
          automated: 30,
          manual: 0,
          degraded: 0,
          healthRatePercent: null,
        },
        collection: { status: "pending", successRatePercent: null },
        intelligence: { signals: 0, publishedEvents: 0 },
        modelAnalysis: { status: "skipped", successfulDays: 0, totalTokens: 0 },
        manualReview: { status: "pending" },
      });
    } finally {
      await db.destroy();
    }
  });

  it("exports and validates the reduced industry site without requiring AI-only pages", async () => {
    const base = loadConfig({
      NODE_ENV: "test",
      DATABASE_URL: "sqlite::memory:",
      INDUSTRY_PROFILE: profileSlug,
      PUBLIC_SITE_URL: "https://chriswang.github.io/agent-pulse/",
    });
    const temp = await mkdtemp(join(tmpdir(), "agent-pulse-industry-"));
    const config = { ...base, distDir: join(temp, "dist") };
    const db = createDatabase(config);
    try {
      await migrateToLatest(db, config);
      await seedDatabase(db, { industryProfileSlug: profileSlug, rootDir: config.rootDir });
      const now = new Date().toISOString();
      await db
        .insertInto("events")
        .values([
          publishedEvent("industry-recent-event", "Recent industry event", now, now),
          publishedEvent(
            "industry-old-event",
            "Older industry event",
            "2020-01-01T00:00:00.000Z",
            now,
          ),
        ])
        .execute();
      await exportStaticSite(db, config);
      const integrity = await validatePublicSite(config.distDir, "2026-07-17T00:00:00.000Z");
      expect(integrity).toMatchObject({
        ok: true,
        counts: { events: 0, signals: 0, actors: 0, sources: 30 },
      });
      expect(integrity.issues).toEqual([]);
      const home = await readFile(join(config.distDir, "index.html"), "utf8");
      expect(home).toContain("医疗健康数据要素情报站");
      expect(home).toContain("industry-lead-hero");
      expect(home).not.toContain("industry-intelligence-heading");
      expect(home).toContain("正在形成的行业方向");
      expect(home).toContain("重点事件");
      expect(home).toContain("值得关注的观点与文章");
      expect(home).toContain("最新来源动态");
      expect(home).not.toContain("BASELINE SCORECARD");
      expect(home).not.toContain("SOURCE HEALTH");
      expect(home).not.toContain("采集成功率");
      expect(home).not.toContain("tokens");
      const policyTrackPage = await readFile(join(config.distDir, "lines/index.html"), "utf8");
      expect(policyTrackPage).toContain("国家数据局 · 通知公告");
      expect(policyTrackPage).not.toContain("暂无匹配来源");
      expect(policyTrackPage.indexOf("国家数据局 · 通知公告")).toBeLessThan(
        policyTrackPage.indexOf("European Medicines Agency News"),
      );
    } finally {
      await db.destroy();
    }
  });

  it("keeps a single-source fact out of the high-priority Top 10", async () => {
    const base = loadConfig({
      NODE_ENV: "test",
      DATABASE_URL: "sqlite::memory:",
      INDUSTRY_PROFILE: profileSlug,
      PUBLIC_SITE_URL: "https://chriswang.github.io/agent-pulse/",
    });
    const temp = await mkdtemp(join(tmpdir(), "agent-pulse-industry-history-integrity-"));
    const config = { ...base, distDir: join(temp, "dist") };
    const db = createDatabase(config);
    try {
      await migrateToLatest(db, config);
      await seedDatabase(db, { industryProfileSlug: profileSlug, rootDir: config.rootDir });
      const repository = new Repository(db);
      const source = (await repository.listSources()).find(
        (item) => item.slug === "national-data-administration",
      );
      const rules = loadIndustryRules(profileSlug, config.rootDir);
      if (!source || !rules) throw new Error("top10_fixture_requires_source_and_rules");
      const now = "2026-07-17T00:00:00.000Z";
      const happenedAt = "2026-06-30T00:00:00.000Z";
      await db
        .insertInto("events")
        .values({
          ...publishedEvent(
            "single-source-high-score",
            "医疗健康数据授权运营政策",
            happenedAt,
            now,
          ),
          confidence_score: 95,
          impact_score: 95,
          value_score: 95,
        })
        .execute();
      const input = {
        title: "国家数据局发布医疗健康数据授权运营政策",
        summary: "正式文件明确医院医疗健康数据的授权运营和合规流通要求。",
        tags: ["医疗健康", "授权运营"],
      };
      const signal = await repository.insertSignal(source.id, {
        url: "https://www.nda.gov.cn/medical-health-authorized-operation.html",
        ...input,
        language: "zh-CN",
        publishedAt: happenedAt,
        category: "policy",
        metrics: {},
        rawMeta: { industryScope: assessIndustryScope(input, { slug: source.slug }, rules) },
      });
      await repository.attachSignal(
        "single-source-high-score",
        signal?.id ?? "missing",
        "primary",
        100,
      );

      const report = await buildIndustryPilotReport(
        db,
        requiredProfile(config.rootDir),
        config.rootDir,
        now,
      );

      expect(report.intelligence.publishedEvents).toBe(1);
      expect(report.intelligence.highPriorityEvents).toBe(0);
      expect(report.topCandidates).toEqual([]);
      expect(report.topItems).toHaveLength(1);
      expect(report.topItems[0]).toMatchObject({ kind: "fact", evidenceStatus: "primary_only" });

      await exportStaticSite(db, config);
      const integrity = await validatePublicSite(config.distDir, now);
      expect(integrity.ok).toBe(true);
      expect(integrity.counts.events).toBe(1);
    } finally {
      await db.destroy();
    }
  });

  it("shows collected signal evidence on a track before a trend conclusion exists", async () => {
    const base = loadConfig({
      NODE_ENV: "test",
      DATABASE_URL: "sqlite::memory:",
      INDUSTRY_PROFILE: profileSlug,
      PUBLIC_SITE_URL: "https://chriswang.github.io/agent-pulse/",
    });
    const temp = await mkdtemp(join(tmpdir(), "agent-pulse-industry-evidence-"));
    const config = { ...base, distDir: join(temp, "dist") };
    const db = createDatabase(config);
    try {
      await migrateToLatest(db, config);
      await seedDatabase(db, { industryProfileSlug: profileSlug, rootDir: config.rootDir });
      const repository = new Repository(db);
      const source = (await repository.listSources()).find(
        (item) => item.slug === "national-data-administration",
      );
      const rules = loadIndustryRules(profileSlug, config.rootDir);
      if (!source || !rules) throw new Error("industry_evidence_fixture_requires_source_and_rules");
      const signal = {
        title: "国家数据局发布医疗健康高质量数据集建设行动方案",
        summary: "方案面向医院和医疗机构，推进医疗健康高质量数据集建设和合规流通。",
        tags: ["医疗健康", "高质量数据集"],
      };
      await repository.insertSignal(source?.id ?? "missing", {
        url: "https://www.nda.gov.cn/medical-health-dataset-plan.html",
        ...signal,
        language: "zh-CN",
        publishedAt: new Date().toISOString(),
        category: "data-elements",
        metrics: {},
        rawMeta: {
          industryScope: assessIndustryScope(signal, { slug: source.slug }, rules),
        },
      });

      await exportStaticSite(db, config);
      const policyTrackPage = await readFile(join(config.distDir, "lines/index.html"), "utf8");
      expect(policyTrackPage).toContain("趋势门槛前已经收集到的证据");
      expect(policyTrackPage).toContain(signal.title);
      expect(policyTrackPage).toContain("先展示事实积累，不把证据不足包装为趋势");
    } finally {
      await db.destroy();
    }
  });
});

function publishedEvent(id: string, title: string, happenedAt: string, now: string) {
  return {
    id,
    slug: id,
    title,
    fact_summary: title,
    summary: title,
    technical_insight: "Validated technical insight.",
    industry_insight: "Validated industry insight.",
    future_outlook: "Continue monitoring the original evidence.",
    business_value: "Supports the industry pilot validation.",
    category: "policy",
    company: "Test institution",
    keywords_json: "[]",
    confidence_score: 80,
    heat_score: 60,
    impact_score: 70,
    value_score: 70,
    score_factors_json: "{}",
    status: "published",
    featured: 0,
    manual_override: 0,
    happened_at: happenedAt,
    published_at: now,
    created_at: now,
    updated_at: now,
  };
}

function requiredProfile(rootDir?: string) {
  const profile = loadIndustryProfile(profileSlug, rootDir);
  if (!profile) throw new Error("industry_profile_fixture_missing");
  return profile;
}

async function count(
  db: ReturnType<typeof createDatabase>,
  table: "sources" | "tracks" | "events" | "actors",
): Promise<number> {
  const row = await db
    .selectFrom(table)
    .select(({ fn }) => fn.countAll<number>().as("count"))
    .executeTakeFirstOrThrow();
  return Number(row.count);
}
