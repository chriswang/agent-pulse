import { describe, expect, it } from "vitest";
import { loadIndustryProfile } from "../src/industry/profile.js";
import { evaluateIndustrySourceGate } from "../src/industry/source-gate.js";

const loadedProfile = loadIndustryProfile("medical-health-data-elements");
if (!loadedProfile) throw new Error("fixture industry profile missing");
const profile = loadedProfile;

function healthyReport() {
  return {
    finishedAt: "2026-07-17T00:00:00.000Z",
    results: profile.trial.readySourceSlugs.map((slug) => ({
      slug,
      status: "healthy",
      latestItemAt: "2026-07-01T00:00:00.000Z",
    })),
  };
}

describe("industry source gate", () => {
  it("requires 12 distinct Chinese publishers plus the 20 percent international set", () => {
    const result = evaluateIndustrySourceGate(profile, healthyReport());

    expect(result).toMatchObject({
      pass: true,
      chineseReadyPublishers: 12,
      minimumChinesePublishers: 12,
      internationalReadyPublishers: 3,
      minimumInternationalPublishers: 3,
    });
    expect(result.chineseReadySlugs).toHaveLength(13);
  });

  it("fails closed when one required Chinese publisher becomes stale", () => {
    const report = healthyReport();
    const source = report.results.find((item) => item.slug === "nhsa-policy");
    if (source) source.latestItemAt = "2025-01-01T00:00:00.000Z";

    const result = evaluateIndustrySourceGate(profile, report);

    expect(result.pass).toBe(false);
    expect(result.chineseReadyPublishers).toBe(11);
    expect(result.rejectedReadySlugs).toContainEqual({
      slug: "nhsa-policy",
      reason: "content_stale",
    });
  });
});
