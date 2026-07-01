export interface AiJsonCompletionInput {
  provider: string;
  model: string;
  messages: Array<{ role: "system" | "user"; content: string }>;
  responseFormat: { type: "json_object" };
  maxTokens: number;
  timeoutMs: number;
}

export interface AiJsonCompletionResult {
  rawContent: string;
  inputTokens: number | null;
  outputTokens: number | null;
  latencyMs: number;
}

export interface AiProvider {
  completeJson(input: AiJsonCompletionInput): Promise<AiJsonCompletionResult>;
}
