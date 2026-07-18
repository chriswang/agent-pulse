import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import type { CollectContext } from "../src/collectors/types.js";
import { webScraperAdapter } from "../src/collectors/web-scraper.js";
import { loadConfig } from "../src/config/env.js";
import type { SourceDescriptor } from "../src/domain/types.js";
import { loadIndustryProfile } from "../src/industry/profile.js";

const slugs = ["nda-expert-interpretation", "36kr-healthcare-feed", "hit180-health-it"] as const;

describe("medical health viewpoint source contracts", () => {
  for (const slug of slugs) {
    it(`extracts dated, original-link evidence from ${slug}`, async () => {
      const source = sourceDescriptor(slug);
      const extension = source.adapter === "rss" ? "xml" : "html";
      const body = await readFile(`tests/fixtures/industry-sources/${slug}.${extension}`, "utf8");
      const adapter =
        source.adapter === "rss"
          ? (await import("../src/collectors/rss.js")).rssAdapter
          : webScraperAdapter;
      const items = await adapter.collect(source, context(body, source.config.url));

      expect(items.length).toBeGreaterThan(0);
      expect(items[0]?.publishedAt).toMatch(/^2026-07-/);
      expect(items[0]?.url).toMatch(new RegExp(`^https://${new URL(source.homepageUrl).hostname}`));
      expect(items[0]?.rawMeta.dateInferred).toBe(false);
    });

    it(`fails closed when ${slug} returns an unusable page`, async () => {
      const source = sourceDescriptor(slug);
      const failedContext = context("", source.config.url);
      failedContext.fetchText = async () => {
        throw new Error("upstream_unavailable");
      };
      await expect(
        source.adapter === "rss"
          ? import("../src/collectors/rss.js").then(({ rssAdapter }) =>
              rssAdapter.collect(source, failedContext),
            )
          : webScraperAdapter.collect(source, failedContext),
      ).rejects.toThrow(/upstream_unavailable/);
    });
  }
});

function sourceDescriptor(slug: (typeof slugs)[number]): SourceDescriptor {
  const profile = loadIndustryProfile("medical-health-data-elements");
  const source = profile?.sources.find((item) => item.slug === slug);
  if (!source) throw new Error(`missing_source_${slug}`);
  return {
    id: slug,
    slug,
    name: source.name,
    homepageUrl: source.homepageUrl,
    adapter: source.adapter,
    tier: source.tier,
    role: source.role,
    region: source.region,
    language: source.language,
    authorityScore: source.authorityScore,
    config: { url: source.endpoint, category: source.category, take: 30 },
    state: {},
  };
}

function context(body: string, finalUrl: string): CollectContext {
  return {
    config: loadConfig({ NODE_ENV: "test", DATABASE_URL: "sqlite::memory:" }),
    fetchText: async () => ({
      body,
      status: 200,
      headers: new Headers(),
      attemptCount: 1,
      responseBytes: body.length,
      finalUrl,
    }),
  };
}
