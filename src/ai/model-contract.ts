export interface JsonCompletionRequest {
  system: string;
  user: string;
  maxTokens?: number;
  thinking?: boolean;
  reasoningEffort?: "low" | "medium" | "high";
  temperature?: number;
}

export interface ModelUsage {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
}

export interface JsonCompletionResult {
  value: unknown;
  usage: ModelUsage;
  model: string;
}

export interface JsonModelClient {
  completeJson(request: JsonCompletionRequest): Promise<JsonCompletionResult>;
}
