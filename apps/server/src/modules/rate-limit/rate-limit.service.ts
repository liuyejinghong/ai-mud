export interface RateLimitResult {
  ok: boolean;
  retryAfterSeconds: number;
}

interface RateLimitBucket {
  count: number;
  resetAt: number;
}

export class InMemoryRateLimitService {
  private readonly buckets = new Map<string, RateLimitBucket>();

  check(input: {
    key: string;
    limit: number;
    windowMs: number;
    now?: Date;
  }): RateLimitResult {
    const nowMs = input.now?.getTime() ?? Date.now();
    const existing = this.buckets.get(input.key);
    if (!existing || existing.resetAt <= nowMs) {
      this.buckets.set(input.key, {
        count: 1,
        resetAt: nowMs + input.windowMs
      });
      return { ok: true, retryAfterSeconds: 0 };
    }

    if (existing.count >= input.limit) {
      return {
        ok: false,
        retryAfterSeconds: Math.max(1, Math.ceil((existing.resetAt - nowMs) / 1000))
      };
    }

    existing.count += 1;
    return { ok: true, retryAfterSeconds: 0 };
  }
}
