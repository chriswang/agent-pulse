import { afterEach, describe, expect, it } from "vitest";
import { loadConfig } from "../src/config/env.js";
import { createDatabase } from "../src/db/database.js";
import { migrateToLatest } from "../src/db/migrate.js";
import { Repository } from "../src/db/repository.js";
import { seedDatabase } from "../src/db/seed.js";

const databases: ReturnType<typeof createDatabase>[] = [];

afterEach(async () => {
  while (databases.length) await databases.pop()?.destroy();
});

describe("signal persistence", () => {
  it("refreshes raw metadata when a canonical URL is observed again", async () => {
    const config = loadConfig({ NODE_ENV: "test", DATABASE_URL: "sqlite::memory:" });
    const db = createDatabase(config);
    databases.push(db);
    await migrateToLatest(db, config);
    await seedDatabase(db);
    const repository = new Repository(db);
    const source = (await repository.listSources()).find((item) => item.slug === "openai");
    const url = "https://openai.com/index/repeated-signal";

    const inserted = await repository.insertSignal(source?.id ?? "missing", {
      url,
      title: "Repeated signal",
      summary: "Initial observation.",
      language: "zh-CN",
      publishedAt: "2026-07-17T00:00:00.000Z",
      category: "policy",
      tags: [],
      metrics: {},
      rawMeta: { quality: { score: 80 } },
    });
    await repository.insertSignal(source?.id ?? "missing", {
      url,
      title: "Repeated signal",
      summary: "The same URL was collected again after industry assessment.",
      language: "zh-CN",
      publishedAt: "2026-07-17T00:00:00.000Z",
      category: "policy",
      tags: [],
      metrics: {},
      rawMeta: {
        industryScope: {
          profileSlug: "medical-health-data-elements",
          rulesVersion: 1,
          decision: "include",
          score: 82,
          matchedStrong: ["医疗健康数据"],
          matchedContext: ["医院"],
          matchedActions: ["政策"],
          matchedEntities: [],
          matchedExclusions: [],
        },
      },
    });

    const refreshed = await db
      .selectFrom("signals")
      .select("raw_meta_json")
      .where("id", "=", inserted?.id ?? "missing")
      .executeTakeFirstOrThrow();
    expect(JSON.parse(refreshed.raw_meta_json)).toMatchObject({
      quality: { score: 80 },
      industryScope: {
        profileSlug: "medical-health-data-elements",
        decision: "include",
        score: 82,
      },
    });
  });
});
