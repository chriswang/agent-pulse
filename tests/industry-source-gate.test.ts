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
      chineseReadyPublishers: 19,
      minimumChinesePublishers: 12,
      internationalReadyPublishers: 3,
      minimumInternationalPublishers: 3,
    });
    expect(result.chineseReadySlugs).toHaveLength(20);
  });

  it("keeps the gate open when one Chinese publisher has a transient failure", () => {
    const report = healthyReport();
    const source = report.results.find((item) => item.slug === "nhsa-policy");
    if (source) source.latestItemAt = "2025-01-01T00:00:00.000Z";

    const result = evaluateIndustrySourceGate(profile, report);

    expect(result.pass).toBe(true);
    expect(result.chineseReadyPublishers).toBe(18);
    expect(result.rejectedReadySlugs).toContainEqual({
      slug: "nhsa-policy",
      reason: "content_stale",
    });
  });

  it("fails closed when redundancy falls below 12 Chinese publishers", () => {
    const report = healthyReport();
    for (const slug of [
      "nhsa-policy",
      "cac-data-policy",
      "chima",
      "guangzhou-data-bureau",
      "china-insurance-association",
      "shanghai-data-exchange",
      "yidu-tech",
      "taimei-health",
    ]) {
      const source = report.results.find((item) => item.slug === slug);
      if (source) source.status = "failed";
    }

    const result = evaluateIndustrySourceGate(profile, report);

    expect(result.pass).toBe(false);
    expect(result.chineseReadyPublishers).toBe(11);
  });
});
