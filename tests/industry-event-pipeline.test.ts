import { afterEach, describe, expect, it } from "vitest";
import { loadConfig } from "../src/config/env.js";
import { createDatabase } from "../src/db/database.js";
import { migrateToLatest } from "../src/db/migrate.js";
import { Repository } from "../src/db/repository.js";
import { seedDatabase } from "../src/db/seed.js";
import { assessIndustryScope, loadIndustryRules } from "../src/industry/rules.js";
import { autoPublishReadyEvents } from "../src/pipeline/auto-publish.js";
import { clusterSignals } from "../src/pipeline/cluster.js";

const databases: ReturnType<typeof createDatabase>[] = [];
afterEach(async () => {
  while (databases.length) await databases.pop()?.destroy();
});

describe("deterministic medical-health fact events", () => {
  it("publishes a Chinese Tier 1 fact with evidence and track links without a model", async () => {
    const profileSlug = "medical-health-data-elements";
    const config = loadConfig({
      NODE_ENV: "test",
      DATABASE_URL: "sqlite::memory:",
      INDUSTRY_PROFILE: profileSlug,
    });
    const db = createDatabase(config);
    databases.push(db);
    await migrateToLatest(db, config);
    await seedDatabase(db, {
      industryProfileSlug: profileSlug,
      rootDir: config.rootDir,
    });
    const repository = new Repository(db);
    const source = (await repository.listSources()).find(
      (item) => item.slug === "national-data-administration",
    );
    const rules = loadIndustryRules(profileSlug, config.rootDir);
    expect(source && rules).toBeTruthy();
    const input = {
      url: "https://www.nda.gov.cn/medical-health-dataset-plan.html",
      title: "国家数据局发布医疗健康高质量数据集建设行动方案",
      summary: "方案面向医院和医疗机构，推进医疗健康高质量数据集建设、合规流通与场景应用。",
      language: "zh-CN",
      publishedAt: new Date().toISOString(),
      category: "data-elements",
      tags: ["医疗健康", "高质量数据集"],
      metrics: {},
    };
    if (!source || !rules) throw new Error("industry_event_fixture_requires_source_and_rules");
    const industryScope = assessIndustryScope(input, { slug: source.slug }, rules);
    await repository.insertSignal(source?.id ?? "missing", {
      ...input,
      rawMeta: { industryScope, quality: { score: 90 } },
    });

    await expect(
      clusterSignals(db, {
        industryProfileSlug: profileSlug,
        rootDir: config.rootDir,
      }),
    ).resolves.toMatchObject({ created: 1, deferred: 0 });
    const event = (await repository.listEvents("review"))[0];
    expect(event).toMatchObject({
      company: "国家数据局 · 通知公告",
      category: "policy-and-compliance",
    });
    expect(event?.fact_summary).toContain("据国家数据局 · 通知公告公开材料");
    expect(event?.technical_insight).not.toContain("待编辑");
    expect(await repository.eventTracks(event?.id ?? "missing")).not.toHaveLength(0);

    await expect(autoPublishReadyEvents(db)).resolves.toMatchObject({
      ready: 1,
      published: 1,
      blocked: 0,
    });
  });

  it("keeps a relevant opinion without a verifiable action as a Signal", async () => {
    const profileSlug = "medical-health-data-elements";
    const config = loadConfig({
      NODE_ENV: "test",
      DATABASE_URL: "sqlite::memory:",
      INDUSTRY_PROFILE: profileSlug,
    });
    const db = createDatabase(config);
    databases.push(db);
    await migrateToLatest(db, config);
    await seedDatabase(db, {
      industryProfileSlug: profileSlug,
      rootDir: config.rootDir,
    });
    const repository = new Repository(db);
    const source = (await repository.listSources()).find((item) => item.slug === "nhsa-policy");
    const rules = loadIndustryRules(profileSlug, config.rootDir);
    if (!source || !rules) throw new Error("industry_opinion_fixture_requires_source_and_rules");
    const input = {
      url: "https://www.nhsa.gov.cn/art/2026/7/12/art_14_21384.html",
      title: "医保数据从“身份证”正在变成“信用卡”",
      summary: "一篇署名分析讨论医保数据公开、药品追溯数据融资和数据质量。",
      language: "zh-CN",
      publishedAt: new Date().toISOString(),
      category: "medical-insurance",
      tags: ["医保数据"],
      metrics: {},
    };
    const industryScope = assessIndustryScope(input, { slug: source.slug }, rules);
    expect(industryScope).toMatchObject({ decision: "include", matchedActions: ["融资"] });
    await repository.insertSignal(source.id, {
      ...input,
      rawMeta: { industryScope, quality: { score: 90 } },
    });

    await expect(
      clusterSignals(db, {
        industryProfileSlug: profileSlug,
        rootDir: config.rootDir,
      }),
    ).resolves.toMatchObject({ created: 0, deferred: 1 });
    expect(await repository.listEvents()).toHaveLength(0);
    expect(await repository.publicSignals()).toHaveLength(1);
  });
});
