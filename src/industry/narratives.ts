import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";
import type { IndustryNarratives } from "../pipeline/static-site/dto.js";
import type { IndustryProfile } from "./profile.js";

const bounded = (minimum: number, maximum: number) => z.string().trim().min(minimum).max(maximum);

const stageSchema = z
  .object({
    start: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    end: z.string().regex(/^(\d{4}-\d{2}-\d{2}|9999-12-31)$/),
    period: bounded(2, 40),
    label: bounded(2, 60),
    summary: bounded(20, 500),
    interpretation: bounded(20, 800),
    chinaPosition: bounded(10, 500),
    nextSignal: bounded(10, 500),
  })
  .strict();

const lensSchema = z
  .object({
    role: z.enum(["ceo", "investor", "cto", "product"]),
    question: bounded(4, 200),
    answer: bounded(10, 600),
    implications: z.array(bounded(4, 300)).max(6),
    actions: z.array(bounded(4, 300)).max(6),
    watch: z.array(bounded(4, 300)).max(6),
    evidenceSlugs: z.array(z.string().min(2).max(180)).max(20),
  })
  .strict();

export const industryNarrativesSchema = z
  .object({
    schemaVersion: z.literal(1),
    horizon: z
      .object({
        start: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
        end: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
        label: bounded(2, 60),
      })
      .strict(),
    eras: z.array(
      z
        .object({
          slug: z.string().regex(/^[a-z0-9][a-z0-9-]{1,79}$/),
          label: bounded(2, 80),
          period: bounded(2, 40),
          summary: bounded(20, 500),
          projects: z.array(
            z
              .object({
                name: bounded(2, 100),
                status: z.enum(["active", "pivoted", "acquired", "sunset"]),
                note: bounded(10, 300),
                url: z.string().url(),
              })
              .strict(),
          ),
        })
        .strict(),
    ),
    tracks: z.array(
      z
        .object({
          slug: z.string().regex(/^[a-z0-9][a-z0-9-]{1,79}$/),
          thesis: bounded(10, 500),
          now: bounded(10, 600),
          next: bounded(10, 500),
          stages: z.array(stageSchema).min(1),
          lenses: z.array(lensSchema).min(1),
        })
        .strict(),
    ),
  })
  .strict();

export async function loadIndustryNarratives(
  profile: IndustryProfile,
  rootDir: string,
): Promise<IndustryNarratives> {
  const path = join(rootDir, "industry-packs", profile.slug, "narratives.json");
  const parsed = industryNarrativesSchema.parse(JSON.parse(await readFile(path, "utf8")));
  const expected = new Set(profile.tracks.map((track) => track.slug));
  const received = new Set(parsed.tracks.map((track) => track.slug));
  if (expected.size !== received.size || [...expected].some((slug) => !received.has(slug))) {
    throw new Error("industry_narrative_track_mismatch");
  }
  const { schemaVersion: _schemaVersion, ...narratives } = parsed;
  return narratives;
}
