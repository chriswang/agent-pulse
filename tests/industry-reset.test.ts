import { afterEach, describe, expect, it } from "vitest";
import { loadConfig } from "../src/config/env.js";
import { createDatabase } from "../src/db/database.js";
import { migrateToLatest } from "../src/db/migrate.js";
import { Repository } from "../src/db/repository.js";
import { seedDatabase } from "../src/db/seed.js";
import { resetIndustryIntelligence } from "../src/industry/reset.js";

const databases: ReturnType<typeof createDatabase>[] = [];
afterEach(async () => {
  while (databases.length) await databases.pop()?.destroy();
});

describe("industry intelligence reset", () => {
  it("removes prior signals and events while preserving the governed source catalog", async () => {
    const config = loadConfig({ NODE_ENV: "test", DATABASE_URL: "sqlite::memory:" });
    const db = createDatabase(config);
    databases.push(db);
    await migrateToLatest(db, config);
    await seedDatabase(db, {
      industryProfileSlug: "medical-health-data-elements",
      rootDir: config.rootDir,
    });
    const repository = new Repository(db);
    const source = (await repository.listSources())[0];
    const signal = await repository.insertSignal(source?.id ?? "missing", {
      url: "https://example.com/medical-data-policy",
      title: "医疗数据政策",
      summary: "医疗数据政策原始材料。",
      language: "zh-CN",
      publishedAt: "2026-07-17T00:00:00.000Z",
      category: "policy",
      tags: [],
      metrics: {},
      rawMeta: {},
    });
    const timestamp = "2026-07-17T00:00:00.000Z";
    await db
      .insertInto("events")
      .values({
        id: "00000000-0000-4000-8000-000000000001",
        slug: "medical-data-policy",
        title: "医疗数据政策",
        fact_summary: "医疗数据政策原始事实。",
        summary: "医疗数据政策原始事实。",
        technical_insight: "事实说明。",
        industry_insight: "行业说明。",
        future_outlook: "继续观察正式文件。",
        business_value: "核对适用业务场景。",
        category: "policy",
        company: "测试机构",
        keywords_json: '["医疗数据"]',
        confidence_score: 70,
        heat_score: 0,
        impact_score: 70,
        value_score: 50,
        score_factors_json: "{}",
        status: "review",
        featured: 0,
        manual_override: 0,
        happened_at: timestamp,
        published_at: null,
        created_at: timestamp,
        updated_at: timestamp,
      })
      .execute();
    await repository.attachSignal(
      "00000000-0000-4000-8000-000000000001",
      signal?.id ?? "missing",
      "supporting",
      100,
    );

    await expect(resetIndustryIntelligence(db)).resolves.toMatchObject({ events: 1, signals: 1 });
    expect(await count(db, "events")).toBe(0);
    expect(await count(db, "signals")).toBe(0);
    expect(await count(db, "sources")).toBe(30);
  });
});

async function count(
  db: ReturnType<typeof createDatabase>,
  table: "sources" | "signals" | "events",
): Promise<number> {
  const row = await db
    .selectFrom(table)
    .select(({ fn }) => fn.countAll<number>().as("count"))
    .executeTakeFirstOrThrow();
  return Number(row.count);
}
