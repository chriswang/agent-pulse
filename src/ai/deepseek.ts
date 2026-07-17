import { OpenAICompatibleClient, type OpenAICompatibleClientOptions } from "./openai-compatible.js";

export type {
  JsonCompletionRequest,
  JsonCompletionResult,
  JsonModelClient,
  ModelUsage,
} from "./model-contract.js";

export interface DeepSeekClientOptions
  extends Omit<
    OpenAICompatibleClientOptions,
    | "baseUrl"
    | "model"
    | "providerName"
    | "jsonMode"
    | "thinkingMode"
    | "supportsReasoningEffort"
    | "errorFactory"
  > {
  baseUrl?: string;
  model?: string;
}

export class DeepSeekError extends Error {
  constructor(
    message: string,
    readonly code: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = "DeepSeekError";
  }
}

export class DeepSeekClient extends OpenAICompatibleClient {
  constructor(options: DeepSeekClientOptions) {
    super({
      ...options,
      baseUrl: options.baseUrl ?? "https://api.deepseek.com",
      model: options.model ?? "deepseek-v4-flash",
      providerName: "DeepSeek",
      jsonMode: "native",
      thinkingMode: "deepseek",
      supportsReasoningEffort: true,
      errorFactory: (message, code, status) => new DeepSeekError(message, code, status),
    });
  }
}
