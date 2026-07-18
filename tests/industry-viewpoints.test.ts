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
import { analyzeIndustryViewpoints } from "../src/industry/viewpoints.js";

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
    expect(report.viewpoints[0]).toMatchObject({
      sourceCount: 2,
      engagement: { measured: false },
      heatStatus: "multi_source_attention",
    });
    expect(report.viewpoints[0]?.heatScore).toBeLessThan(60);
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
