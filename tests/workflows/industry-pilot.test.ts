import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

const readWorkflow = (name: string) => readFile(`.github/workflows/${name}`, "utf8");

describe("medical health industry workflows", () => {
  it("keeps runtime data isolated and runs deterministic collection before optional Ark AI", async () => {
    const workflow = await readWorkflow("industry-pilot.yml");
    expect(workflow).toContain("INDUSTRY_PROFILE: medical-health-data-elements");
    expect(workflow).toContain(
      "REPOSITORY_SNAPSHOT_PATH: industry-packs/medical-health-data-elements/data/snapshot.json",
    );
    expect(workflow).not.toContain("data/snapshot/v1.json");
    expect(workflow).toContain("MODEL_PROVIDER: ark");
    expect(workflow).toContain("MODEL_NAME: glm-5.2");
    expect(workflow).toContain("MODEL_API_KEY: $" + "{{ secrets.MODEL_API_KEY }}");
    expect(workflow.indexOf("npm run collect")).toBeLessThan(
      workflow.indexOf("Enrich evidence-ready Events with Ark GLM-5.2"),
    );
    expect(workflow.indexOf("npm run auto:publish")).toBeLessThan(
      workflow.indexOf("npm run --silent industry:report"),
    );
    expect(workflow).toContain("npm run --silent public:validate");
    expect(workflow).toContain('git add -- "$REPOSITORY_SNAPSHOT_PATH"');
  });

  it("deploys only the isolated industry artifact to the personal GitHub Pages site", async () => {
    const workflow = await readWorkflow("industry-pages.yml");
    expect(workflow).toContain("https://chriswang.github.io/agent-pulse/");
    expect(workflow).toContain("https://github.com/chriswang/agent-pulse");
    expect(workflow).toContain(
      "REPOSITORY_SNAPSHOT_PATH: industry-packs/medical-health-data-elements/data/snapshot.json",
    );
    expect(workflow).toContain("npm run --silent public:validate");
    expect(workflow).toContain("actions/deploy-pages@v5");
    expect(workflow).not.toContain("MODEL_API_KEY");
    expect(workflow).not.toContain("secrets.");
  });
});
