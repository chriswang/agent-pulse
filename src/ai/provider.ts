import type { AppConfig } from "../config/env.js";
import { DeepSeekClient } from "./deepseek.js";
import type { JsonModelClient } from "./model-contract.js";
import { OpenAICompatibleClient } from "./openai-compatible.js";

export interface ModelClientOptions {
  timeoutMs?: number;
  maxAttempts?: number;
  fetch?: typeof fetch;
  sleep?: (milliseconds: number) => Promise<void>;
}

export interface ModelIdentity {
  provider: "deepseek" | "ark" | "openai-compatible";
  baseUrl: string;
  model: string;
  jsonMode: "native" | "prompt-only";
}

export function resolveModelIdentity(config: AppConfig): ModelIdentity {
  const provider = config.MODEL_PROVIDER ?? "deepseek";
  const baseUrl =
    config.MODEL_BASE_URL ??
    (provider === "ark"
      ? "https://ark.cn-beijing.volces.com/api/coding/v3"
      : config.DEEPSEEK_BASE_URL);
  const model = config.MODEL_NAME ?? config.DEEPSEEK_MODEL;
  const jsonMode = config.MODEL_JSON_MODE ?? (provider === "deepseek" ? "native" : "prompt-only");
  return { provider, baseUrl, model, jsonMode };
}

export function createJsonModelClient(
  config: AppConfig,
  options: ModelClientOptions = {},
): JsonModelClient {
  const identity = resolveModelIdentity(config);
  const apiKey = config.MODEL_API_KEY ?? config.DEEPSEEK_API_KEY;
  if (!apiKey) throw new Error("MODEL_API_KEY is required when AI is enabled");
  if (identity.provider === "deepseek") {
    return new DeepSeekClient({
      apiKey,
      baseUrl: identity.baseUrl,
      model: identity.model,
      ...options,
    });
  }
  return new OpenAICompatibleClient({
    apiKey,
    baseUrl: identity.baseUrl,
    model: identity.model,
    providerName: identity.provider === "ark" ? "Volcengine Ark" : "Model provider",
    jsonMode: identity.jsonMode,
    thinkingMode: "none",
    supportsReasoningEffort: false,
    ...options,
  });
}
