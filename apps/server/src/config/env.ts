import { z } from "zod";

const envSchema = z
  .object({
    NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
    PLAYTEST_REGISTRATION_ENABLED: z
      .string()
      .optional()
      .transform((value) => (value === undefined ? false : value === "true")),
    SERVER_HOST: z.string().default("127.0.0.1"),
    SERVER_PORT: z.coerce.number().int().positive().default(3000),
    DATABASE_URL: z.string().min(1),
    SESSION_COOKIE_NAME: z.string().default("ai_mud_session"),
    // cookie Secure 标志：HTTPS 部署必须为 true；内测 HTTP 部署显式设 false。
    // 缺省按 NODE_ENV 推断（production → true）。
    SESSION_COOKIE_SECURE: z
      .string()
      .optional()
      .transform((value) => (value === undefined ? undefined : value === "true")),
    SESSION_SECRET: z.string().min(32),
    WEB_ORIGINS: z
      .string()
      .default("http://127.0.0.1:5173")
      .transform((value) =>
        value
          .split(",")
          .map((origin) => origin.trim())
          .filter(Boolean)
      ),
    ADMIN_BOOTSTRAP_EMAIL: z.string().email().optional(),
    ADMIN_BOOTSTRAP_PASSWORD: z.string().min(12).optional(),
    WORLD_TICK_ENABLED: z
      .string()
      .optional()
      .transform((value) => (value === undefined ? true : value === "true")),
    WORLD_TICK_INTERVAL_MS: z.coerce.number().int().positive().default(60_000),
    WORLD_TICK_MAX_STEPS: z.coerce.number().int().positive().default(60),
    // 旧西幻（黑松）世界开关，默认关闭（第 0 阶段车道 C1–C3，评审 ARCH-boundaries-01/02）。
    // 关闭时：旧 NPC 世界结算、旧副本资源刷新、post-tick 旧 NPC 任务与传闻不进 tick；
    // /game/* 与旧世界管理接口（含世界重置）不注册。代码与数据保留，仅供旧世界回归/仿真显式开启。
    // 只有字面 "true" 开启；读取一律经 isLegacyWorldEnabled()。
    LEGACY_WORLD_ENABLED: z
      .string()
      .optional()
      .transform((value) => (value === undefined ? undefined : value === "true")),
    // 连接池与会话超时（车道 C5，评审 ARCH-domain-08）：未设置时由 db/client.ts
    // DEFAULT_DB_POOL_OPTIONS 给出有限默认值；不接受 0（pg 的 0 = 无限等待/不限时）。
    DB_POOL_MAX: z.coerce.number().int().positive().optional(),
    DB_POOL_CONNECTION_TIMEOUT_MS: z.coerce.number().int().positive().optional(),
    DB_STATEMENT_TIMEOUT_MS: z.coerce.number().int().positive().optional(),
    DB_IDLE_IN_TRANSACTION_TIMEOUT_MS: z.coerce.number().int().positive().optional(),
    TEST_GATHERING_CYCLE_MS: z.coerce.number().int().min(100).max(5_000).optional(),
    AI_NPC_DIALOGUE_ENABLED: z
      .string()
      .optional()
      .transform((value) => (value === undefined ? false : value === "true")),
    AI_PROVIDER: z.enum(["template", "deepseek"]).default("template"),
    DEEPSEEK_API_KEY: z.string().optional(),
    DEEPSEEK_BASE_URL: z.string().url().default("https://api.deepseek.com"),
    DEEPSEEK_MODEL: z.string().default("deepseek-v4-flash"),
    AI_DIALOGUE_TIMEOUT_MS: z.coerce.number().int().positive().default(8_000),
    AI_DIALOGUE_MAX_OUTPUT_TOKENS: z.coerce.number().int().positive().max(1_000).default(400),
    TYPE_SAFE_DECISION_MODE: z.enum(["off", "shadow"]).default("off"),
    TYPE_SAFE_API_KEY: z.string().optional(),
    TYPE_SAFE_MODEL: z.string().default("jev-latest"),
    TYPE_SAFE_BASE_URL: z.string().url().default("https://openrouter.ai/api/v1"),
    AI_DAILY_TOKEN_BUDGET: z
      .string()
      .optional()
      .transform((value) => {
        if (value === undefined || value.trim() === "") return null;
        const parsed = Number(value);
        return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
      })
  })
  .superRefine((value, context) => {
    if (Boolean(value.ADMIN_BOOTSTRAP_EMAIL) !== Boolean(value.ADMIN_BOOTSTRAP_PASSWORD)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "ADMIN_BOOTSTRAP_EMAIL and ADMIN_BOOTSTRAP_PASSWORD must be set together",
        path: ["ADMIN_BOOTSTRAP_EMAIL"]
      });
    }
    if (value.TEST_GATHERING_CYCLE_MS !== undefined && value.NODE_ENV !== "test") {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "TEST_GATHERING_CYCLE_MS is only allowed when NODE_ENV=test",
        path: ["TEST_GATHERING_CYCLE_MS"]
      });
    }
  });

export type Env = z.infer<typeof envSchema>;

export function loadEnv(input: NodeJS.ProcessEnv = process.env): Env {
  return envSchema.parse(input);
}

export function isLegacyWorldEnabled(env: Pick<Env, "LEGACY_WORLD_ENABLED">): boolean {
  return env.LEGACY_WORLD_ENABLED === true;
}
