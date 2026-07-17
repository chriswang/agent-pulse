import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import type { CatalogSource } from "../catalog/sources.js";

const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

const sourceCategorySchema = z.enum([
  "frontier-lab",
  "china-lab",
  "research-eval",
  "open-source",
  "agent-devtool",
  "robotics",
  "infra-chip-cloud",
  "capital-business",
  "model-economics",
  "policy",
  "expert",
  "media",
  "community-heat",
  "aggregator",
]);

const industrySourceSchema = z
  .object({
    slug: z.string().regex(/^[a-z0-9][a-z0-9-]{1,79}$/),
    name: z.string().min(2).max(120),
    homepageUrl: z.string().url().startsWith("https://"),
    endpoint: z.string().url().startsWith("https://"),
    adapter: z.enum(["rss", "generic-api", "github-releases", "web-scraper", "manual"]),
    tier: z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4)]),
    role: z.enum(["primary", "research", "expert", "media", "heat", "policy"]),
    region: z.string().min(2).max(20),
    language: z.string().min(2).max(20),
    authorityScore: z.number().int().min(1).max(100),
    qualityScore: z.number().int().min(1).max(100),
    lifecycleStatus: z.enum(["draft", "shadow", "active"]).default("shadow"),
    category: sourceCategorySchema,
    acquisition: z.enum(["rss", "api", "github", "arxiv", "html", "social", "manual"]),
    topics: z.array(z.string().min(1).max(80)).min(1).max(20),
    maintenanceStatus: z.enum(["ready", "candidate", "restricted", "manual"]),
    cadence: z.string().min(2).max(40),
    licenseNote: z.string().min(10).max(500),
    purpose: z.string().min(4).max(240),
    identityHosts: z.array(z.string().min(3).max(120)).min(1).max(10),
  })
  .strict();

const industryTrackSchema = z
  .object({
    slug: z.string().regex(/^[a-z0-9][a-z0-9-]{1,79}$/),
    name: z.string().min(2).max(80),
    description: z.string().min(10).max(300),
    perspective: z.string().min(2).max(40),
    color: z.string().regex(/^#[0-9a-fA-F]{6}$/),
    icon: z.string().min(1).max(4),
    order: z.number().int().min(1).max(1_000),
  })
  .strict();

export const IndustryProfileSchema = z
  .object({
    schemaVersion: z.literal(1),
    slug: z.string().regex(/^[a-z0-9][a-z0-9-]{1,79}$/),
    name: z.string().min(4).max(100),
    shortName: z.string().min(2).max(40),
    description: z.string().min(20).max(500),
    page: z
      .object({
        eyebrow: z.string().min(2).max(80),
        headline: z.string().min(4).max(120),
        deck: z.string().min(20).max(300),
      })
      .strict(),
    audiences: z.array(z.string().min(2).max(40)).min(3).max(20),
    topics: z.array(z.string().min(2).max(80)).min(3).max(30),
    competitorGroups: z.array(z.string().min(2).max(80)).min(1).max(20),
    keywords: z.array(z.string().min(2).max(80)).min(5).max(100),
    tracks: z.array(industryTrackSchema).length(6),
    sources: z.array(industrySourceSchema).min(20).max(30),
    trial: z
      .object({
        durationDays: z.literal(7),
        minimumCollectionSuccessRate: z.number().min(0).max(100),
        topN: z.number().int().min(1).max(20),
        readySourceSlugs: z
          .array(z.string().regex(/^[a-z0-9][a-z0-9-]{1,79}$/))
          .min(1)
          .max(30),
      })
      .strict(),
    model: z
      .object({
        provider: z.literal("ark"),
        baseUrl: z.string().url().startsWith("https://"),
        name: z.string().min(2).max(100),
      })
      .strict(),
  })
  .strict()
  .superRefine((profile, context) => {
    checkUnique(profile.sources, "slug", ["sources"], context);
    checkUnique(profile.tracks, "slug", ["tracks"], context);
    const automated = profile.sources.filter(
      (source) =>
        source.adapter !== "manual" && !["manual", "restricted"].includes(source.maintenanceStatus),
    );
    if (automated.length < 20) {
      context.addIssue({
        code: "custom",
        path: ["sources"],
        message: "Industry pilot requires at least 20 automated candidate sources",
      });
    }
    const sourceBySlug = new Map(profile.sources.map((source) => [source.slug, source]));
    const readySlugs = new Set<string>();
    for (const [index, slug] of profile.trial.readySourceSlugs.entries()) {
      const source = sourceBySlug.get(slug);
      if (readySlugs.has(slug)) {
        context.addIssue({
          code: "custom",
          path: ["trial", "readySourceSlugs", index],
          message: `Duplicate pilot-ready source: ${slug}`,
        });
      } else if (!source) {
        context.addIssue({
          code: "custom",
          path: ["trial", "readySourceSlugs", index],
          message: `Unknown pilot-ready source: ${slug}`,
        });
      } else if (
        source.adapter === "manual" ||
        ["manual", "restricted"].includes(source.maintenanceStatus)
      ) {
        context.addIssue({
          code: "custom",
          path: ["trial", "readySourceSlugs", index],
          message: `Pilot-ready source must be automated: ${slug}`,
        });
      }
      readySlugs.add(slug);
    }
  });

export type IndustryProfile = z.infer<typeof IndustryProfileSchema>;

export function loadIndustryProfile(
  slug = process.env.INDUSTRY_PROFILE,
  repositoryRoot = rootDir,
): IndustryProfile | null {
  if (!slug) return null;
  if (!/^[a-z0-9][a-z0-9-]{1,79}$/.test(slug)) throw new Error("invalid_industry_profile_slug");
  const path = join(repositoryRoot, "industry-packs", slug, "profile.json");
  return IndustryProfileSchema.parse(JSON.parse(readFileSync(path, "utf8")));
}

export function industrySources(profile: IndustryProfile): CatalogSource[] {
  const pilotReady = new Set(profile.trial.readySourceSlugs);
  return profile.sources.map(({ purpose: _purpose, ...source }) => {
    const ready = pilotReady.has(source.slug);
    return {
      ...source,
      enabled: ready || source.lifecycleStatus === "active",
      lifecycleStatus: ready ? "active" : source.lifecycleStatus,
      maintenanceStatus: ready ? "ready" : source.maintenanceStatus,
    };
  });
}

function checkUnique<T extends Record<K, string>, K extends keyof T>(
  values: T[],
  key: K,
  path: (string | number)[],
  context: z.RefinementCtx,
): void {
  const seen = new Set<string>();
  for (const [index, value] of values.entries()) {
    if (seen.has(value[key])) {
      context.addIssue({
        code: "custom",
        path: [...path, index, String(key)],
        message: `Duplicate ${String(key)}: ${value[key]}`,
      });
    }
    seen.add(value[key]);
  }
}
