import { spawn, type ChildProcess } from "node:child_process";
import { once } from "node:events";
import { readdir, readFile } from "node:fs/promises";
import { createServer } from "node:net";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { createDb } from "../src/db/client.js";
import { AuthRepository } from "../src/modules/auth/auth.repository.js";
import { AuthService } from "../src/modules/auth/auth.service.js";
import { DrizzleActivationCodeRepository } from "../src/modules/activation-code/activation-code.repository.js";
import { ActivationCodeService } from "../src/modules/activation-code/activation-code.service.js";
import { LedgerRepository } from "../src/modules/ledger/ledger.repository.js";
import { LedgerService } from "../src/modules/ledger/ledger.service.js";
import { NpcRepository } from "../src/modules/npc/npc.repository.js";
import { NpcService } from "../src/modules/npc/npc.service.js";
import { GameRepository } from "../src/modules/game/game.repository.js";
import { GameService } from "../src/modules/game/game.service.js";

interface Journal {
  entries: Array<{ idx: number; tag: string }>;
}

const { Client } = pg;
const serverRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const repositoryRoot = dirname(dirname(serverRoot));
const webRoot = join(repositoryRoot, "apps", "web");
const drizzleDir = join(serverRoot, "drizzle");
const journalPath = join(drizzleDir, "meta", "_journal.json");
const adminEmail = "real-e2e-admin@example.test";
const adminPassword = "real-e2e-admin-password";
const playerEmail = "real-e2e-player@example.test";
const playerPassword = "real-e2e-player-password";
const returningPlayerEmail = "real-e2e-returning@example.test";
const returningPlayerPassword = "real-e2e-returning-password";
const sessionSecret = "real-e2e-session-secret-that-is-at-least-32-characters";

function quoteIdentifier(value: string) {
  return `"${value.replace(/"/g, '""')}"`;
}

function makeTempDatabaseName() {
  return `ai_mud_real_e2e_${Date.now()}_${process.pid}`;
}

function databaseUrlForName(databaseUrl: string, databaseName: string) {
  const url = new URL(databaseUrl);
  url.pathname = `/${databaseName}`;
  return url.toString();
}

function pnpmCommand() {
  return process.platform === "win32" ? "pnpm.cmd" : "pnpm";
}

function delay(milliseconds: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, milliseconds));
}

async function readJournal() {
  return JSON.parse(await readFile(journalPath, "utf8")) as Journal;
}

function splitMigration(sql: string) {
  return sql
    .split("--> statement-breakpoint")
    .map((statement) => statement.trim())
    .filter(Boolean);
}

async function assertJournalMatchesSqlFiles(journal: Journal) {
  const sqlTags = (await readdir(drizzleDir))
    .filter((file) => /^\d{4}_.+\.sql$/.test(file))
    .map((file) => file.replace(/\.sql$/, ""))
    .sort();
  const journalTags = journal.entries
    .slice()
    .sort((left, right) => left.idx - right.idx)
    .map((entry) => entry.tag);

  if (JSON.stringify(sqlTags) !== JSON.stringify(journalTags)) {
    throw new Error("Migration journal does not match the SQL migration files.");
  }
}

async function applyMigrations(client: pg.Client, journal: Journal) {
  for (const entry of journal.entries.slice().sort((left, right) => left.idx - right.idx)) {
    const sql = await readFile(join(drizzleDir, `${entry.tag}.sql`), "utf8");
    for (const statement of splitMigration(sql)) {
      await client.query(statement);
    }
  }
}

async function dropDatabase(admin: pg.Client, databaseName: string) {
  const identifier = quoteIdentifier(databaseName);
  try {
    await admin.query(`DROP DATABASE IF EXISTS ${identifier} WITH (FORCE)`);
  } catch {
    await admin.query(
      `
        SELECT pg_terminate_backend(pid)
        FROM pg_stat_activity
        WHERE datname = $1
          AND pid <> pg_backend_pid()
      `,
      [databaseName]
    );
    await admin.query(`DROP DATABASE IF EXISTS ${identifier}`);
  }
}

async function findFreePort() {
  const server = createServer();
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("Unable to reserve a local port for the real E2E run.");
  }
  await new Promise<void>((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
  return address.port;
}

async function runCommand(
  command: string,
  arguments_: string[],
  options: { cwd: string; env?: NodeJS.ProcessEnv }
) {
  const child = spawn(command, arguments_, {
    cwd: options.cwd,
    env: options.env,
    stdio: "inherit"
  });
  await new Promise<void>((resolve, reject) => {
    child.once("error", reject);
    child.once("exit", (code, signal) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(new Error(`${command} ${arguments_.join(" ")} exited with ${code ?? signal ?? "error"}.`));
    });
  });
}

async function waitForHealth(url: string, process: ChildProcess) {
  for (let attempt = 0; attempt < 80; attempt += 1) {
    if (process.exitCode !== null) {
      throw new Error(`The real E2E server stopped before becoming healthy (${process.exitCode}).`);
    }
    try {
      const response = await fetch(`${url}/health`);
      if (response.ok) return;
    } catch {
      // The server has not bound its local port yet.
    }
    await delay(100);
  }
  throw new Error("Timed out waiting for the real E2E server health check.");
}

async function stopProcess(process: ChildProcess | null) {
  if (!process || process.exitCode !== null) return;
  process.kill("SIGTERM");
  const exited = await Promise.race([once(process, "exit").then(() => true), delay(5_000).then(() => false)]);
  if (!exited && process.exitCode === null) {
    process.kill("SIGKILL");
    await once(process, "exit");
  }
}

async function seedWorldAndActivationCode(databaseUrl: string) {
  const connection = createDb(databaseUrl);
  try {
    const auth = new AuthService();
    const accounts = new AuthRepository(connection.db);
    const admin = await accounts.createAccount({
      email: adminEmail,
      passwordHash: await auth.hashPassword(adminPassword),
      role: "admin"
    });
    await new NpcService(
      new NpcRepository(connection.db),
      new LedgerService(new LedgerRepository(connection.db))
    ).ensureWorldSeeded(new Date());
    const activationCodes = new ActivationCodeService(
      new DrizzleActivationCodeRepository(connection.db)
    );
    const activation = await activationCodes.create({
      note: "real-postgres-e2e",
      createdByAdminId: admin.id
    });
    const returningAccount = await accounts.createAccount({
      email: returningPlayerEmail,
      passwordHash: await auth.hashPassword(returningPlayerPassword)
    });
    const returningCharacter = await new GameService(connection.db).createCharacter(
      returningAccount.id,
      { name: "E2E归来者", classId: "ranger" }
    );
    await new GameRepository(connection.db).updateCharacterNeeds({
      characterId: returningCharacter.character!.id,
      hunger: 0,
      lastHungerSettledAt: new Date()
    });
    return activation;
  } finally {
    await connection.close();
  }
}

async function main() {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error("DATABASE_URL is required to run the real PostgreSQL E2E suite.");
  }

  const journal = await readJournal();
  await assertJournalMatchesSqlFiles(journal);
  const databaseName = makeTempDatabaseName();
  const targetDatabaseUrl = databaseUrlForName(databaseUrl, databaseName);
  const admin = new Client({ connectionString: databaseUrl });
  let migrated: pg.Client | null = null;
  let server: ChildProcess | null = null;

  await admin.connect();
  try {
    await admin.query(`CREATE DATABASE ${quoteIdentifier(databaseName)}`);
    migrated = new Client({ connectionString: targetDatabaseUrl });
    await migrated.connect();
    await applyMigrations(migrated, journal);
    await migrated.end();
    migrated = null;

    const activation = await seedWorldAndActivationCode(targetDatabaseUrl);
    const [serverPort, webPort] = await Promise.all([findFreePort(), findFreePort()]);
    const apiBase = `http://127.0.0.1:${serverPort}`;
    const runtimeEnv = {
      ...process.env,
      NODE_ENV: "test",
      DATABASE_URL: targetDatabaseUrl,
      SERVER_HOST: "127.0.0.1",
      SERVER_PORT: String(serverPort),
      SESSION_SECRET: sessionSecret,
      WEB_ORIGINS: `http://127.0.0.1:${webPort}`,
      ADMIN_BOOTSTRAP_EMAIL: adminEmail,
      ADMIN_BOOTSTRAP_PASSWORD: adminPassword,
      WORLD_TICK_ENABLED: "false",
      PLAYTEST_REGISTRATION_ENABLED: "true",
      AI_NPC_DIALOGUE_ENABLED: "false",
      TEST_GATHERING_CYCLE_MS: "200",
      VITE_API_BASE: apiBase,
      PLAYWRIGHT_WEB_PORT: String(webPort),
      REAL_E2E_ACTIVATION_CODE: activation.code,
      REAL_E2E_PLAYER_EMAIL: playerEmail,
      REAL_E2E_PLAYER_PASSWORD: playerPassword,
      REAL_E2E_RETURNING_PLAYER_EMAIL: returningPlayerEmail,
      REAL_E2E_RETURNING_PLAYER_PASSWORD: returningPlayerPassword
    };

    await runCommand(pnpmCommand(), ["--filter", "@ai-mud/shared", "build"], {
      cwd: repositoryRoot,
      env: runtimeEnv
    });
    await runCommand(pnpmCommand(), ["--filter", "@ai-mud/content", "build"], {
      cwd: repositoryRoot,
      env: runtimeEnv
    });
    await runCommand(pnpmCommand(), ["--filter", "@ai-mud/game-rules", "build"], {
      cwd: repositoryRoot,
      env: runtimeEnv
    });
    await runCommand(pnpmCommand(), ["--filter", "@ai-mud/ai-prompts", "build"], {
      cwd: repositoryRoot,
      env: runtimeEnv
    });

    server = spawn(process.execPath, ["--import", "tsx", "src/main.ts"], {
      cwd: serverRoot,
      env: runtimeEnv,
      stdio: "inherit"
    });
    await waitForHealth(apiBase, server);
    await runCommand(
      pnpmCommand(),
      ["exec", "playwright", "test", "-c", "playwright.config.ts", `--project=${process.env.REAL_E2E_PROJECT ?? "real-postgres"}`, "--workers=1"],
      { cwd: webRoot, env: runtimeEnv }
    );
  } finally {
    await stopProcess(server);
    if (migrated) await migrated.end();
    await dropDatabase(admin, databaseName);
    await admin.end();
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
