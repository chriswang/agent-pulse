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
  it("keeps 20-30 governed sources and Ark GLM-5.2 settings in one public pack", () => {
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
    expect(profile.trial.readySourceSlugs).toHaveLength(18);
    expect(sources.filter((source) => source.enabled)).toHaveLength(18);
    expect(
      sources
        .filter((source) => source.enabled)
        .every(
          (source) => source.lifecycleStatus === "active" && source.maintenanceStatus === "ready",
        ),
    ).toBe(true);
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
    profile.trial.readySourceSlugs = ["national-health-commission"];
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
          automated: 21,
          manual: 9,
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
