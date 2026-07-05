import { z } from "zod";

const envSchema = z
  .object({
    NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
    SERVER_HOST: z.string().default("127.0.0.1"),
    SERVER_PORT: z.coerce.number().int().positive().default(3000),
    DATABASE_URL: z.string().min(1),
    SESSION_COOKIE_NAME: z.string().default("ai_mud_session"),
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
  });

export type Env = z.infer<typeof envSchema>;

export function loadEnv(input: NodeJS.ProcessEnv = process.env): Env {
  return envSchema.parse(input);
}
