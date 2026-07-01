import type { AiJsonCompletionInput, AiJsonCompletionResult, AiProvider } from "./ai-provider.js";

interface DeepSeekCompletionResponse {
  choices?: Array<{ message?: { content?: string } }>;
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
  };
}

export interface DeepSeekAiProviderOptions {
  apiKey: string;
  baseUrl: string;
  fetchImpl?: typeof fetch;
}

export class DeepSeekAiProvider implements AiProvider {
  private readonly fetchImpl: typeof fetch;

  constructor(private readonly options: DeepSeekAiProviderOptions) {
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  async completeJson(input: AiJsonCompletionInput): Promise<AiJsonCompletionResult> {
    const startedAt = Date.now();
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), input.timeoutMs);

    try {
      const response = await this.fetchImpl(`${this.options.baseUrl.replace(/\/$/, "")}/chat/completions`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${this.options.apiKey}`
        },
        body: JSON.stringify({
          model: input.model,
          messages: input.messages,
          response_format: input.responseFormat,
          max_tokens: input.maxTokens,
          stream: false
        }),
        signal: controller.signal
      });

      if (!response.ok) {
        throw new Error(`DeepSeek request failed: ${response.status}`);
      }

      const body = (await response.json()) as DeepSeekCompletionResponse;
      const rawContent = body.choices?.[0]?.message?.content;
      if (!rawContent) throw new Error("DeepSeek response missing content");

      return {
        rawContent,
        inputTokens: body.usage?.prompt_tokens ?? null,
        outputTokens: body.usage?.completion_tokens ?? null,
        latencyMs: Date.now() - startedAt
      };
    } finally {
      clearTimeout(timeout);
    }
  }
}
