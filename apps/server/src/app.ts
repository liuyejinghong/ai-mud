import cookie from "@fastify/cookie";
import cors from "@fastify/cors";
import Fastify from "fastify";
import { loadEnv, type Env } from "./config/env.js";
import { createDb, type Db, type DbConnection } from "./db/client.js";
import { registerAuthRoutes } from "./modules/auth/auth.routes.js";

declare module "fastify" {
  interface FastifyInstance {
    config: Env;
    di: {
      db: Db;
    };
  }
}

export async function buildApp(input?: { env?: Env; db?: Db }) {
  const app = Fastify({ logger: true });
  const config = input?.env ?? loadEnv();
  let dbConnection: DbConnection | null = null;
  let db: Db;

  if (input?.db) {
    db = input.db;
  } else {
    dbConnection = createDb(config.DATABASE_URL);
    db = dbConnection.db;
  }

  app.decorate("config", config);
  app.decorate("di", { db });

  if (dbConnection) {
    app.addHook("onClose", async () => {
      await dbConnection.close();
    });
  }

  await app.register(cors, { origin: true, credentials: true });
  await app.register(cookie, { secret: config.SESSION_SECRET });
  await app.register(registerAuthRoutes);

  app.get("/health", async () => ({ ok: true, service: "ai-mud-server" }));

  return app;
}
