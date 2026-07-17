import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { loadConfig } from "../src/config/env.js";
import { createDatabase } from "../src/db/database.js";
import { migrateToLatest } from "../src/db/migrate.js";
import { seedDatabase } from "../src/db/seed.js";
import { buildIndustryPilotReport } from "../src/industry/pilot-report.js";
import {
  IndustryProfileSchema,
  industrySources,
  loadIndustryProfile,
} from "../src/industry/profile.js";
import { exportStaticSite } from "../src/pipeline/export.js";
import { validatePublicSite } from "../src/pipeline/public-site-integrity.js";

const profileSlug = "medical-health-data-elements";

describe("medical health data elements industry profile", () => {
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
      phase: "baseline",
      baselineDays: 30,
      baselineStartDate: "2026-07-17",
      durationDays: 7,
      targetChinaContentPercent: 80,
      minimumChineseReadySources: 12,
      maximumReadySourceAgeDays: 90,
    });
    expect(profile.trial.readySourceSlugs).toHaveLength(18);
    expect(sources.filter((source) => source.enabled)).toHaveLength(18);
    expect(sources.filter((source) => source.enabled && source.region === "CN")).toHaveLength(15);
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
        "2026-07-17T00:00:00.000Z",
      );
      expect(report).toMatchObject({
        readiness: "collecting",
        sources: {
          configured: 30,
          automated: 30,
          manual: 0,
          degraded: 0,
          healthRatePercent: null,
        },
        collection: { status: "pending", successRatePercent: null },
        intelligence: { signals: 0, publishedEvents: 0 },
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
