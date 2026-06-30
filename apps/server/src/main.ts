import Fastify from "fastify";

const app = Fastify({ logger: true });

app.get("/health", async () => ({ ok: true, service: "ai-mud-server" }));

const port = Number(process.env.SERVER_PORT ?? 3000);
const host = process.env.SERVER_HOST ?? "127.0.0.1";

await app.listen({ host, port });
