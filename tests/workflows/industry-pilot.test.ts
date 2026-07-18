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
    expect(workflow).toContain('MODEL_ENRICHMENT_ENABLED: "true"');
    expect(workflow).toContain("MODEL_API_KEY: $" + "{{ secrets.MODEL_API_KEY }}");
    expect(workflow.indexOf("industry:sources:gate")).toBeLessThan(
      workflow.indexOf("npm run collect"),
    );
    expect(workflow).toContain("if: $" + "{{ env.MODEL_ENRICHMENT_ENABLED == 'true' }}");
    expect(workflow).toContain("npm run --silent industry:reset -- --confirm");
    expect(workflow).toContain("--backfill --lookback-days=30 --max-pages=6 --drain");
    expect(workflow).toContain('cron: "17 12 19-24 7 *"');
    expect(workflow.indexOf("industry:reset")).toBeLessThan(workflow.indexOf("npm run collect"));
    expect(workflow.indexOf("npm run collect")).toBeLessThan(
      workflow.indexOf("Cluster industry viewpoints with Ark GLM-5.2"),
    );
    expect(workflow).toContain("npm run --silent industry:viewpoints");
    expect(workflow.indexOf("npm run collect")).toBeLessThan(
      workflow.indexOf("Enrich evidence-ready Events with Ark GLM-5.2"),
    );
    expect(workflow.indexOf("npm run auto:publish")).toBeLessThan(
      workflow.indexOf("npm run --silent industry:report"),
    );
    expect(workflow).toContain("npm run --silent public:validate");
    expect(workflow).toContain("npx biome format --write");
    expect(workflow.indexOf("npx biome format --write")).toBeLessThan(
      workflow.indexOf('git add -- "$REPOSITORY_SNAPSHOT_PATH"'),
    );
    expect(workflow).toContain('git add -- "$REPOSITORY_SNAPSHOT_PATH"');
    expect(workflow).toContain("industry-packs/medical-health-data-elements/data/viewpoints.json");
  });

  it("can verify the source gate on GitHub without calling a model or deploying", async () => {
    const workflow = await readWorkflow("industry-source-audit.yml");
    expect(workflow).toContain("DATABASE_URL: sqlite:./var/medical-health-source-audit.db");
    expect(workflow).not.toContain("DATABASE_URL: sqlite:$" + "{{ runner.temp }}");
    expect(workflow).toContain("npm run sources:audit");
    expect(workflow).toContain("industry:sources:gate");
    expect(workflow).toContain("chineseReadyPublishers");
    expect(workflow).not.toContain("MODEL_API_KEY");
    expect(workflow).not.toContain("secrets.");
    expect(workflow).not.toContain("deploy-pages");
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
