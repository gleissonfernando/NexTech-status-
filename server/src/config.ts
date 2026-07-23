import path from "node:path";
import { config as loadEnv } from "dotenv";
import { z } from "zod";

loadEnv();

const envSchema = z.object({
  PORT: z.coerce.number().int().positive().default(8080),
  NODE_ENV: z
    .enum(["development", "test", "production"])
    .default("development"),
  PUBLIC_STATUS_URL: z.string().url().default("http://localhost:8080"),
  PLATFORM_BASE_URL: z.string().url().default("http://localhost:3000"),
  PLATFORM_PANEL_URL: z.string().url().default("http://localhost:3000"),
  CORS_ORIGINS: z.string().default("http://localhost:5173,http://localhost:8080"),
  ADMIN_TOKEN: z.string().min(16).default("change-this-admin-token"),
  INGEST_TOKEN: z.string().min(16).optional(),
  DATABASE_PATH: z.string().default("./data/status.sqlite"),
  DEFAULT_CHECK_INTERVAL_SECONDS: z.coerce.number().int().min(10).default(60),
  DEFAULT_TIMEOUT_MS: z.coerce.number().int().min(500).default(5000),
  HISTORY_RETENTION_HOURS: z.coerce.number().int().min(1).default(72),
  ENABLE_MONITORING: z
    .string()
    .default("true")
    .transform((value) => value !== "false"),
  RATE_LIMIT_WINDOW_MS: z.coerce.number().int().positive().default(60000),
  RATE_LIMIT_MAX: z.coerce.number().int().positive().default(120)
});

export type AppConfig = z.infer<typeof envSchema> & {
  corsOrigins: string[];
  databasePath: string;
};

export function readConfig(env = process.env): AppConfig {
  const parsed = envSchema.parse(env);
  if (parsed.NODE_ENV === "production") {
    const insecureAdminToken =
      parsed.ADMIN_TOKEN === "change-this-admin-token" || parsed.ADMIN_TOKEN.length < 32;
    const insecureIngestToken =
      !parsed.INGEST_TOKEN ||
      parsed.INGEST_TOKEN === "change-this-ingest-token" ||
      parsed.INGEST_TOKEN.length < 32;
    if (insecureAdminToken || insecureIngestToken) {
      throw new Error(
        "Production requires strong ADMIN_TOKEN and INGEST_TOKEN with at least 32 characters."
      );
    }
    if (parsed.CORS_ORIGINS.split(",").map((origin) => origin.trim()).includes("*")) {
      throw new Error("Production CORS_ORIGINS must not contain '*'.");
    }
  }

  return {
    ...parsed,
    corsOrigins: parsed.CORS_ORIGINS.split(",")
      .map((origin) => origin.trim())
      .filter(Boolean),
    databasePath:
      parsed.DATABASE_PATH === ":memory:"
        ? ":memory:"
        : path.resolve(parsed.DATABASE_PATH)
  };
}
