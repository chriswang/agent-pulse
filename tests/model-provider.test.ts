import { describe, expect, it, vi } from "vitest";
import { createJsonModelClient, resolveModelIdentity } from "../src/ai/provider.js";
import { loadConfig } from "../src/config/env.js";

describe("provider-neutral JSON model client", () => {
  it("uses Ark standard Chat Completions without DeepSeek-only parameters", async () => {
    const request = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      expect(String(url)).toBe("https://ark.cn-beijing.volces.com/api/v3/chat/completions");
      expect(new Headers(init?.headers).get("authorization")).toBe("Bearer ark-secret-value");
      const body = JSON.parse(String(init?.body));
      expect(body.model).toBe("glm-5.2");
      expect(body.response_format).toBeUndefined();
      expect(body.thinking).toBeUndefined();
      expect(body.reasoning_effort).toBeUndefined();
      expect(body.messages[0].content).toContain("Return exactly one valid JSON object");
      return new Response(
        JSON.stringify({
          model: "glm-5.2",
          choices: [
            {
              finish_reason: "stop",
              message: { content: '```json\n{"ok":true}\n```' },
            },
          ],
          usage: { prompt_tokens: 9, completion_tokens: 5, total_tokens: 14 },
        }),
        { status: 200 },
      );
    });
    const config = loadConfig({
      NODE_ENV: "test",
      DATABASE_URL: "sqlite::memory:",
      MODEL_PROVIDER: "ark",
      MODEL_API_KEY: "ark-secret-value",
      MODEL_BASE_URL: "https://ark.cn-beijing.volces.com/api/v3",
      MODEL_NAME: "glm-5.2",
      MODEL_JSON_MODE: "prompt-only",
    });
    const client = createJsonModelClient(config, {
      fetch: request as typeof fetch,
      maxAttempts: 1,
    });

    await expect(client.completeJson({ system: "system", user: "user" })).resolves.toEqual({
      value: { ok: true },
      model: "glm-5.2",
      usage: { promptTokens: 9, completionTokens: 5, totalTokens: 14 },
    });
  });

  it("falls back to the legacy DeepSeek configuration when no generic provider is set", () => {
    const config = loadConfig({
      NODE_ENV: "test",
      DATABASE_URL: "sqlite::memory:",
      DEEPSEEK_API_KEY: "legacy-secret-value",
      DEEPSEEK_BASE_URL: "https://api.deepseek.com",
      DEEPSEEK_MODEL: "deepseek-v4-flash",
    });

    expect(resolveModelIdentity(config)).toEqual({
      provider: "deepseek",
      baseUrl: "https://api.deepseek.com",
      model: "deepseek-v4-flash",
      jsonMode: "native",
    });
  });
});
