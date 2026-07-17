import { z } from "zod";
import type {
  JsonCompletionRequest,
  JsonCompletionResult,
  JsonModelClient,
} from "./model-contract.js";

export type JsonMode = "native" | "prompt-only";

export interface OpenAICompatibleClientOptions {
  apiKey: string;
  baseUrl: string;
  model: string;
  providerName?: string;
  jsonMode?: JsonMode;
  thinkingMode?: "deepseek" | "none";
  supportsReasoningEffort?: boolean;
  timeoutMs?: number;
  maxAttempts?: number;
  fetch?: typeof fetch;
  sleep?: (milliseconds: number) => Promise<void>;
  errorFactory?: (message: string, code: string, status?: number) => Error;
}

const responseSchema = z.object({
  model: z.string().optional(),
  choices: z
    .array(
      z.object({
        finish_reason: z.string().nullable().optional(),
        message: z.object({ content: z.string() }),
      }),
    )
    .min(1),
  usage: z
    .object({
      prompt_tokens: z.number().int().nonnegative().optional(),
      completion_tokens: z.number().int().nonnegative().optional(),
      total_tokens: z.number().int().nonnegative().optional(),
    })
    .optional(),
});

export class OpenAICompatibleError extends Error {
  constructor(
    message: string,
    readonly code: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = "OpenAICompatibleError";
  }
}

export class OpenAICompatibleClient implements JsonModelClient {
  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly model: string;
  private readonly providerName: string;
  private readonly jsonMode: JsonMode;
  private readonly thinkingMode: "deepseek" | "none";
  private readonly supportsReasoningEffort: boolean;
  private readonly timeoutMs: number;
  private readonly maxAttempts: number;
  private readonly request: typeof fetch;
  private readonly wait: (milliseconds: number) => Promise<void>;
  private readonly makeError: (message: string, code: string, status?: number) => Error;

  constructor(options: OpenAICompatibleClientOptions) {
    this.apiKey = options.apiKey;
    this.baseUrl = options.baseUrl.replace(/\/$/, "");
    this.model = options.model;
    this.providerName = options.providerName ?? "Model provider";
    this.jsonMode = options.jsonMode ?? "prompt-only";
    this.thinkingMode = options.thinkingMode ?? "none";
    this.supportsReasoningEffort = options.supportsReasoningEffort ?? false;
    this.timeoutMs = options.timeoutMs ?? 60_000;
    this.maxAttempts = options.maxAttempts ?? 3;
    this.request = options.fetch ?? fetch;
    this.wait =
      options.sleep ??
      ((milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)));
    this.makeError =
      options.errorFactory ??
      ((message, code, status) => new OpenAICompatibleError(message, code, status));
  }

  async completeJson(request: JsonCompletionRequest): Promise<JsonCompletionResult> {
    for (let attempt = 1; attempt <= this.maxAttempts; attempt += 1) {
      let response: Response;
      try {
        response = await this.request(`${this.baseUrl}/chat/completions`, {
          method: "POST",
          headers: {
            authorization: `Bearer ${this.apiKey}`,
            "content-type": "application/json",
          },
          body: JSON.stringify(this.requestBody(request)),
          signal: AbortSignal.timeout(this.timeoutMs),
        });
      } catch (error) {
        if (attempt < this.maxAttempts) {
          await this.wait(backoffMilliseconds(attempt));
          continue;
        }
        throw this.makeError(
          `${this.providerName} request failed after ${attempt} attempts: ${safeNetworkError(error)}`,
          "network_error",
        );
      }

      if (!response.ok) {
        const code = await safeApiErrorCode(response);
        if (isRetryable(response.status) && attempt < this.maxAttempts) {
          await this.wait(retryDelayMilliseconds(response, attempt));
          continue;
        }
        throw this.makeError(
          `${this.providerName} request failed with HTTP ${response.status}${code ? ` (${code})` : ""}`,
          code ?? `http_${response.status}`,
          response.status,
        );
      }

      let payload: z.infer<typeof responseSchema>;
      try {
        payload = responseSchema.parse(await response.json());
      } catch {
        throw this.makeError(
          `${this.providerName} returned an invalid response envelope`,
          "invalid_response",
        );
      }
      const choice = payload.choices[0];
      if (!choice)
        throw this.makeError(`${this.providerName} returned no completion choice`, "empty_choice");
      if (choice.finish_reason === "length") {
        throw this.makeError(
          `${this.providerName} JSON completion was truncated`,
          "truncated_response",
        );
      }
      let value: unknown;
      try {
        value = JSON.parse(unwrapJsonContent(choice.message.content));
      } catch {
        throw this.makeError(`${this.providerName} returned invalid JSON content`, "invalid_json");
      }
      const promptTokens = payload.usage?.prompt_tokens ?? 0;
      const completionTokens = payload.usage?.completion_tokens ?? 0;
      return {
        value,
        model: payload.model ?? this.model,
        usage: {
          promptTokens,
          completionTokens,
          totalTokens: payload.usage?.total_tokens ?? promptTokens + completionTokens,
        },
      };
    }
    throw this.makeError(`${this.providerName} retry loop exhausted`, "retry_exhausted");
  }

  private requestBody(request: JsonCompletionRequest): Record<string, unknown> {
    const jsonInstruction =
      "Return exactly one valid JSON object. Do not include Markdown fences, commentary, or text outside the JSON object.";
    return {
      model: this.model,
      messages: [
        {
          role: "system",
          content:
            this.jsonMode === "prompt-only"
              ? `${request.system.trim()}\n\n${jsonInstruction}`
              : request.system,
        },
        { role: "user", content: request.user },
      ],
      ...(this.jsonMode === "native" ? { response_format: { type: "json_object" } } : {}),
      ...(this.thinkingMode === "deepseek"
        ? { thinking: { type: request.thinking ? "enabled" : "disabled" } }
        : {}),
      ...(this.supportsReasoningEffort && request.reasoningEffort
        ? { reasoning_effort: request.reasoningEffort }
        : {}),
      temperature: request.temperature ?? 0.1,
      max_tokens: request.maxTokens ?? 1_800,
      stream: false,
    };
  }
}

function unwrapJsonContent(value: string): string {
  const trimmed = value.trim();
  const fenced = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  return (fenced?.[1] ?? trimmed).trim();
}

function isRetryable(status: number): boolean {
  return status === 408 || status === 429 || status >= 500;
}

function backoffMilliseconds(attempt: number): number {
  return Math.min(8_000, 500 * 2 ** (attempt - 1) + Math.round(Math.random() * 250));
}

function retryDelayMilliseconds(response: Response, attempt: number): number {
  const value = response.headers.get("retry-after");
  if (!value) return backoffMilliseconds(attempt);
  const seconds = Number(value);
  if (Number.isFinite(seconds)) return Math.min(30_000, Math.max(0, seconds * 1_000));
  const date = Date.parse(value);
  return Number.isFinite(date)
    ? Math.min(30_000, Math.max(0, date - Date.now()))
    : backoffMilliseconds(attempt);
}

async function safeApiErrorCode(response: Response): Promise<string | null> {
  try {
    const payload = (await response.json()) as { error?: { code?: unknown; type?: unknown } };
    const value = payload.error?.code ?? payload.error?.type;
    return typeof value === "string" ? value.slice(0, 80) : null;
  } catch {
    return null;
  }
}

function safeNetworkError(error: unknown): string {
  if (error instanceof Error && error.name === "TimeoutError") return "timeout";
  if (error instanceof Error && error.name === "AbortError") return "aborted";
  return "network error";
}
