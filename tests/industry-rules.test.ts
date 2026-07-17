import { describe, expect, it } from "vitest";
import { assessIndustryScope, loadIndustryRules } from "../src/industry/rules.js";

const loadedRules = loadIndustryRules("medical-health-data-elements");
if (!loadedRules) throw new Error("industry rules fixture missing");
const rules = loadedRules;

describe("medical health industry relevance rules", () => {
  it("includes a Chinese policy action with direct data-element evidence", () => {
    const result = assessIndustryScope(
      {
        title: "发布医疗健康高质量数据集建设指南",
        summary: "面向医院推进健康医疗数据授权运营与可信流通。",
        tags: [],
      },
      { slug: "national-data-administration" },
      rules,
    );

    expect(result.decision).toBe("include");
    expect(result.matchedStrong).toContain("高质量数据集");
  });

  it("includes international evidence only when it is a relevant benchmark", () => {
    const relevant = assessIndustryScope(
      {
        title: "OHDSI releases an update to the OMOP Common Data Model",
        summary: "The standard supports interoperable real-world data across health systems.",
        tags: [],
      },
      { slug: "ohdsi-news" },
      rules,
    );
    const generic = assessIndustryScope(
      {
        title: "A regulator publishes a general public health reminder",
        summary: "The announcement contains only general wellness guidance.",
        tags: [],
      },
      { slug: "fda-press-releases" },
      rules,
    );

    expect(relevant.decision).toBe("include");
    expect(generic.decision).not.toBe("include");
  });

  it("excludes generic health content without data-element evidence", () => {
    const result = assessIndustryScope(
      {
        title: "儿童肥胖预防与日常运动建议",
        summary: "面向患者家庭的健康教育内容。",
        tags: [],
      },
      { slug: "chima" },
      rules,
    );

    expect(result.decision).toBe("exclude");
    expect(result.matchedExclusions).toContain("儿童肥胖");
  });

  it("keeps a named competitor data product action in scope", () => {
    const result = assessIndustryScope(
      {
        title: "镁信健康推出健康险经营数据智能平台",
        summary: "平台服务保险公司理赔与健康管理场景。",
        tags: [],
      },
      { slug: "meditrust-health" },
      rules,
    );

    expect(result.decision).toBe("include");
    expect(result.matchedEntities).toContain("镁信健康");
  });

  it("excludes generic data-element activity without a medical or health context", () => {
    const result = assessIndustryScope(
      {
        title: "2026年数据要素大赛交通运输赛道正式启动",
        summary: "活动聚焦交通运输和气象领域的数据流通与安全治理。",
        tags: [],
      },
      { slug: "national-data-administration" },
      rules,
    );

    expect(result.matchedStrong).toContain("数据要素");
    expect(result.decision).toBe("exclude");
  });

  it("lets a title exclusion override data terms leaked from adjacent list items", () => {
    const result = assessIndustryScope(
      {
        title: "省卫生健康委召开全省卫生健康系统防汛抗旱工作调度",
        summary: "相邻列表还显示省卫生健康委举行医疗健康高质量数据集建设主题沙龙。",
        tags: [],
      },
      { slug: "jiangsu-health-commission" },
      rules,
    );

    expect(result.matchedStrong).toContain("高质量数据集");
    expect(result.matchedExclusions).toContain("防汛抗旱");
    expect(result.decision).toBe("exclude");
  });
});
