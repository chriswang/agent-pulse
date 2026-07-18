import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { JsonModelClient } from "../src/ai/model-contract.js";
import { loadConfig } from "../src/config/env.js";
import { createDatabase } from "../src/db/database.js";
import { migrateToLatest } from "../src/db/migrate.js";
import { Repository } from "../src/db/repository.js";
import { seedDatabase } from "../src/db/seed.js";
import { loadIndustryProfile } from "../src/industry/profile.js";
import { assessIndustryScope, loadIndustryRules } from "../src/industry/rules.js";
import {
  analyzeIndustryViewpoints,
  reconcileIndustryViewpoints,
} from "../src/industry/viewpoints.js";

const databases: ReturnType<typeof createDatabase>[] = [];

afterEach(async () => {
  while (databases.length) await databases.pop()?.destroy();
});

describe("industry viewpoint analysis", () => {
  it("clusters evidence-backed viewpoints while keeping heat deterministic", async () => {
    const { db, config, profile } = await fixture();
    await insertViewpointSignals(db, config.rootDir);
    let candidateCount = 0;
    const client: JsonModelClient = {
      async completeJson(request) {
        const input = JSON.parse(request.user) as { inputs: Array<{ url: string }> };
        candidateCount = input.inputs.length;
        return {
          model: "glm-5.2",
          usage: { promptTokens: 100, completionTokens: 80, totalTokens: 180 },
          value: {
            viewpoints: [
              {
                claim: "医疗健康数据流通的关键正在从平台建设转向可验证的授权与应用闭环",
                summary:
                  "两篇行业材料都认为，仅建设数据平台不足以形成数据要素价值，还需要明确授权链路、使用边界和可复核的业务结果。",
                nature: "analysis",
                stance: "cautionary",
                trackSlugs: ["health-data-infrastructure"],
                audiences: ["医院", "数据集团"],
                whyItMatters: "这会直接影响医院和数据运营方应优先投入平台能力还是场景运营能力。",
                counterpoint: "当前材料仍来自行业观察者，尚不能代替项目运行数据和客户采用证据。",
                nextSignal: "继续观察公开采购、授权运营项目及可量化的数据产品调用结果。",
                evidenceUrls: input.inputs.map((item) => item.url),
              },
              {
                claim: "AI编程工具将提升医院信息科的软件交付效率",
                summary: "医院信息科可以使用AI编程工具缓解工程师短缺并加快一般软件开发。",
                nature: "opinion",
                stance: "supportive",
                trackSlugs: ["health-data-infrastructure"],
                audiences: ["医院"],
                whyItMatters: "医院信息科可能改变通用软件开发和人员配置方式。",
                counterpoint: "生成代码仍存在安全和维护风险，需要专业人员审核。",
                nextSignal: "观察更多医院公开AI编程项目的交付周期。",
                evidenceUrls: [input.inputs[0]?.url ?? ""],
              },
            ],
          },
        };
      },
    };
    const outputPath = join(await mkdtemp(join(tmpdir(), "viewpoints-")), "viewpoints.json");

    const report = await analyzeIndustryViewpoints(
      db,
      profile,
      config.rootDir,
      client,
      {
        provider: "ark",
        baseUrl: profile.model.baseUrl,
        model: profile.model.name,
        jsonMode: "prompt-only",
      },
      { referenceAt: "2026-07-18T12:00:00.000Z", outputPath },
    );

    expect(candidateCount).toBe(2);
    expect(report.model).toMatchObject({ status: "success", name: "glm-5.2" });
    expect(report.model.usage.totalTokens).toBe(180);
    expect(report.viewpoints).toHaveLength(1);
    expect(report.viewpoints[0]).toMatchObject({
      sourceCount: 2,
      engagement: { measured: false },
      heatStatus: "multi_source_attention",
    });
    expect(report.viewpoints[0]?.heatScore).toBeLessThan(60);
    expect(reconcileIndustryViewpoints(report, ["https://unrelated.example/item"])).toMatchObject({
      model: { status: "skipped", name: "not-run" },
      runs: [],
      viewpoints: [],
    });
  });

  it("rejects model evidence URLs that were not in the bounded input", async () => {
    const { db, config, profile } = await fixture();
    await insertViewpointSignals(db, config.rootDir);
    const outputPath = join(
      await mkdtemp(join(tmpdir(), "viewpoints-invalid-")),
      "viewpoints.json",
    );
    const report = await analyzeIndustryViewpoints(
      db,
      profile,
      config.rootDir,
      invalidClient(),
      {
        provider: "ark",
        baseUrl: profile.model.baseUrl,
        model: profile.model.name,
        jsonMode: "prompt-only",
      },
      { referenceAt: "2026-07-18T12:00:00.000Z", outputPath },
    );

    expect(report.model.status).toBe("failed");
    expect(report.runs[0]?.errorCode).toBe("unknown_evidence_url");
    expect(report.viewpoints).toEqual([]);
  });

  it("bounds a request to 16 ranked candidates and no more than 5 per source", async () => {
    const { db, config, profile } = await fixture();
    await insertManyViewpointSignals(db, config.rootDir);
    let promptInputs: Array<{ url: string; sourceSlug: string; summary: string }> = [];
    let promptRules: string[] = [];
    let requestedMaxTokens: number | undefined;
    const client: JsonModelClient = {
      async completeJson(request) {
        const input = JSON.parse(request.user) as {
          inputs: typeof promptInputs;
          rules: string[];
        };
        promptInputs = input.inputs;
        promptRules = input.rules;
        requestedMaxTokens = request.maxTokens;
        return {
          model: "glm-5.2",
          usage: { promptTokens: 100, completionTokens: 80, totalTokens: 180 },
          value: { viewpoints: [validViewpoint([input.inputs[0]?.url ?? ""])] },
        };
      },
    };
    const outputPath = join(
      await mkdtemp(join(tmpdir(), "viewpoints-bounded-")),
      "viewpoints.json",
    );

    const report = await analyzeIndustryViewpoints(
      db,
      profile,
      config.rootDir,
      client,
      {
        provider: "ark",
        baseUrl: profile.model.baseUrl,
        model: profile.model.name,
        jsonMode: "prompt-only",
      },
      { referenceAt: "2026-07-18T12:00:00.000Z", outputPath },
    );

    expect(report.model.status).toBe("success");
    expect(promptInputs).toHaveLength(16);
    expect(Math.max(...sourceCounts(promptInputs))).toBeLessThanOrEqual(5);
    expect(promptInputs.every((item) => item.summary.length <= 480)).toBe(true);
    expect(requestedMaxTokens).toBe(4_000);
    expect(promptRules.some((rule) => rule.includes("最多输出 5 个"))).toBe(true);
  });
});

async function fixture() {
  const config = loadConfig({ NODE_ENV: "test", DATABASE_URL: "sqlite::memory:" });
  const db = createDatabase(config);
  databases.push(db);
  await migrateToLatest(db, config);
  await seedDatabase(db, {
    industryProfileSlug: "medical-health-data-elements",
    rootDir: config.rootDir,
  });
  const profile = loadIndustryProfile("medical-health-data-elements", config.rootDir);
  if (!profile) throw new Error("missing_industry_profile");
  return { db, config, profile };
}

async function insertViewpointSignals(
  db: ReturnType<typeof createDatabase>,
  rootDir: string,
): Promise<void> {
  const repository = new Repository(db);
  const rules = loadIndustryRules("medical-health-data-elements", rootDir);
  if (!rules) throw new Error("missing_industry_rules");
  const sources = await repository.listSources();
  for (const [index, slug] of ["nda-expert-interpretation", "hit180-health-it"].entries()) {
    const source = sources.find((item) => item.slug === slug);
    if (!source) throw new Error(`missing_${slug}`);
    const input = {
      title: index ? "医疗健康数据要素价值需要真实应用闭环" : "专家解读医疗健康数据授权运营机制",
      summary: "行业分析讨论医院医疗健康数据授权运营、数据流通和业务应用的验证路径。",
      tags: ["医疗健康数据", "数据授权运营"],
    };
    await repository.insertSignal(source.id, {
      url: `https://${index ? "www.hit180.com" : "www.nda.gov.cn"}/viewpoint-${index}`,
      ...input,
      language: "zh-CN",
      publishedAt: `2026-07-${17 + index}T08:00:00.000Z`,
      category: "analysis",
      metrics: { platforms: ["web"] },
      rawMeta: { industryScope: assessIndustryScope(input, { slug }, rules) },
    });
  }
}

async function insertManyViewpointSignals(
  db: ReturnType<typeof createDatabase>,
  rootDir: string,
): Promise<void> {
  const repository = new Repository(db);
  const rules = loadIndustryRules("medical-health-data-elements", rootDir);
  if (!rules) throw new Error("missing_industry_rules");
  const sources = await repository.listSources();
  const slugs = ["nda-expert-interpretation", "chima", "36kr-healthcare-feed", "hit180-health-it"];
  for (const [sourceIndex, slug] of slugs.entries()) {
    const source = sources.find((item) => item.slug === slug);
    if (!source) throw new Error(`missing_${slug}`);
    for (let index = 0; index < 7; index += 1) {
      const input = {
        title: `医疗健康数据要素授权运营与应用闭环观察 ${sourceIndex}-${index}`,
        summary:
          "医疗健康数据要素行业分析关注医院数据授权运营、可信流通、保险应用与可验证业务闭环。".repeat(
            8,
          ),
        tags: ["医疗健康数据", "数据授权运营"],
      };
      await repository.insertSignal(source.id, {
        url: `https://example.com/${slug}/viewpoint-${index}`,
        ...input,
        language: "zh-CN",
        publishedAt: `2026-07-${String(10 + index).padStart(2, "0")}T08:00:00.000Z`,
        category: "analysis",
        metrics: { platforms: ["web"] },
        rawMeta: { industryScope: assessIndustryScope(input, { slug }, rules) },
      });
    }
  }
}

function validViewpoint(evidenceUrls: string[]) {
  return {
    claim: "医疗健康数据流通的关键正在从平台建设转向可验证的授权与应用闭环",
    summary: "行业材料认为平台建设需要与授权链路、使用边界和可复核业务结果结合。",
    nature: "analysis",
    stance: "cautionary",
    trackSlugs: ["health-data-infrastructure"],
    audiences: ["医院", "数据集团"],
    whyItMatters: "这会影响医院和数据运营方的平台能力与场景运营投入优先级。",
    counterpoint: "当前公开材料仍不足以代替项目运行数据和客户采用证据。",
    nextSignal: "继续观察公开采购、授权运营项目和可量化的数据产品调用结果。",
    evidenceUrls,
  };
}

function sourceCounts(inputs: Array<{ sourceSlug: string }>): number[] {
  const counts = new Map<string, number>();
  for (const input of inputs) {
    counts.set(input.sourceSlug, (counts.get(input.sourceSlug) ?? 0) + 1);
  }
  return [...counts.values()];
}

function invalidClient(): JsonModelClient {
  return {
    async completeJson() {
      return {
        model: "glm-5.2",
        usage: { promptTokens: 10, completionTokens: 10, totalTokens: 20 },
        value: {
          viewpoints: [
            {
              claim: "医疗健康数据行业出现新的观点",
              summary: "材料提出了医疗健康数据授权运营与业务价值验证之间的关系。",
              nature: "opinion",
              stance: "neutral",
              trackSlugs: ["health-data-infrastructure"],
              audiences: ["医院"],
              whyItMatters: "该观点可能影响医院的数据治理投入优先级和实施路径。",
              counterpoint: "当前仍缺少独立项目数据用于验证这一判断。",
              nextSignal: "继续观察后续公开项目和业务采用数据。",
              evidenceUrls: ["https://invalid.example/evidence"],
            },
          ],
        },
      };
    },
  };
}
