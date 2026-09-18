// pnpm arch:test — prove the boundary checker actually goes red.
// Builds 12 isolated fixture projects (NEG-01..12 from modularity-baseline.md §3),
// runs arch-check against each as a subprocess, and asserts the expected verdict.
// Deliberately-broken files never enter the game build: fixtures live in temp dirs.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const CHECKER = path.join(path.dirname(fileURLToPath(import.meta.url)), "arch-check.mjs");

// ---------- fixture scaffolding ----------

function baseCatalog(extra = []) {
  return {
    schemaVersion: 1,
    modules: [
      { id: "kernel", kind: "pure", allowedDependencies: [] },
      { id: "content", kind: "pure", allowedDependencies: ["kernel"] },
      { id: "rules", kind: "pure", allowedDependencies: ["kernel", "content"] },
      { id: "protocol", kind: "contract", allowedDependencies: ["kernel"] },
      { id: "platform", kind: "infrastructure", allowedDependencies: ["kernel"] },
      { id: "identity", kind: "business", allowedDependencies: ["kernel", "platform"] },
      { id: "world", kind: "business", allowedDependencies: ["kernel", "content", "rules", "platform"] },
      { id: "assets", kind: "business", allowedDependencies: ["kernel", "content", "rules", "platform"] },
      { id: "characters", kind: "business", allowedDependencies: ["kernel", "content", "rules", "platform", "world", "assets"] },
      { id: "economy", kind: "business", allowedDependencies: ["kernel", "content", "rules", "platform", "assets"] },
      { id: "npc", kind: "business", allowedDependencies: ["kernel", "content", "rules", "platform", "world", "assets"] },
      { id: "quests", kind: "business", allowedDependencies: ["kernel", "content", "rules", "platform", "assets"] },
      { id: "social", kind: "business", allowedDependencies: ["kernel", "platform"] },
      { id: "ai", kind: "capability", allowedDependencies: ["kernel", "platform"] },
      { id: "observation", kind: "read_model", allowedDependencies: ["kernel", "platform", "identity", "world", "assets", "characters", "economy", "npc", "quests", "social"] },
      { id: "application", kind: "orchestration", allowedDependencies: ["kernel", "platform", "identity", "world", "assets", "characters", "economy", "npc", "quests", "social", "ai", "observation"] },
      { id: "transport", kind: "adapter", allowedDependencies: ["kernel", "protocol", "platform", "application"] },
      { id: "composition", kind: "composition", allowedDependencies: ["kernel", "platform", "identity", "world", "assets", "characters", "economy", "npc", "quests", "social", "ai", "observation", "application", "transport"] },
      { id: "client_session", kind: "client", allowedDependencies: ["kernel", "protocol"] },
      { id: "client_text", kind: "client", allowedDependencies: ["kernel", "protocol", "client_session"] },
      { id: "client_pixel", kind: "client_design_only", allowedDependencies: ["kernel", "protocol", "client_session"] },
      ...extra,
    ],
  };
}

function fileEntry(pathP, module, layer, scope = "production", extra = {}) {
  return { path: pathP, module, layer, scope, ...extra };
}

function writeFixture(root, { files, catalog = baseCatalog(), debt = { entries: [] }, unlisted = [] }) {
  fs.mkdirSync(path.join(root, "docs/architecture"), { recursive: true });
  const boundaries = {
    schemaVersion: 1,
    status: "FROZEN_TEST",
    files: files.map((f) => (typeof f === "string" ? JSON.parse(f) : f)),
  };
  fs.writeFileSync(path.join(root, "docs/architecture/module-catalog.json"), JSON.stringify(catalog, null, 1));
  fs.writeFileSync(path.join(root, "docs/architecture/module-boundaries.json"), JSON.stringify(boundaries, null, 1));
  fs.writeFileSync(path.join(root, "docs/architecture/legacy-boundary-debt.json"), JSON.stringify(debt, null, 1));
  for (const [p, content] of Object.entries(unlisted)) {
    const abs = path.join(root, p);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, content);
  }
  for (const f of files) {
    if (typeof f === "string" || !f.content) continue;
    const abs = path.join(root, f.path);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, f.content);
  }
}

const f = fileEntry;

const FIXTURES = [
  {
    id: "NEG-01",
    expect: "fail",
    ruleHint: "DISALLOWED_DEPENDENCY_EDGE",
    desc: "npc deep-imports quests internal repository",
    setup: (root) =>
      writeFixture(root, {
        files: [
          { ...f("src/modules/npc/service.ts", "npc", "domain"), content: `import { Q } from "../quests/internal/quest.repository.js";\nexport const use = Q;\n` },
          { ...f("src/modules/quests/internal/quest.repository.ts", "quests", "persistence"), content: `export const Q = 1;\n` },
        ],
      }),
  },
  {
    id: "NEG-02",
    expect: "fail",
    ruleHint: "DISALLOWED_DEPENDENCY_EDGE",
    desc: "same deep import via type-only statement",
    setup: (root) =>
      writeFixture(root, {
        files: [
          { ...f("src/modules/npc/service.ts", "npc", "domain"), content: `import type { Q } from "../quests/internal/quest.repository.js";\nexport const x: typeof Q = null as never;\n` },
          { ...f("src/modules/quests/internal/quest.repository.ts", "quests", "persistence"), content: `export type Q = number;\n` },
        ],
      }),
  },
  {
    id: "NEG-03",
    expect: "fail",
    ruleHint: "PUBLIC_WILDCARD_OR_ORM_LEAK",
    desc: "public.ts wildcard re-exports internals",
    setup: (root) =>
      writeFixture(root, {
        files: [
          { ...f("src/modules/npc/public.ts", "npc", "public"), content: `export * from "./internal/repo.js";\n` },
          { ...f("src/modules/npc/internal/repo.ts", "npc", "persistence"), content: `export const row = {};\n` },
        ],
      }),
  },
  {
    id: "NEG-04",
    expect: "fail",
    ruleHint: "MODULE_CYCLE",
    desc: "economy <-> npc direct cycle (no debt)",
    setup: (root) =>
      writeFixture(root, {
        files: [
          { ...f("src/modules/economy/a.ts", "economy", "domain"), content: `import { b } from "../npc/b.js";\nexport const a = b;\n` },
          { ...f("src/modules/npc/b.ts", "npc", "domain"), content: `import { a } from "../economy/a.js";\nexport const b = a;\n` },
        ],
      }),
  },
  {
    id: "NEG-05",
    expect: "fail",
    ruleHint: "CLIENT_SERVER_BOUNDARY",
    desc: "React client imports server db schema",
    setup: (root) =>
      writeFixture(root, {
        files: [
          { ...f("src/client/view.tsx", "client_text", "client_view"), content: `import { s } from "../../server/db/schema.js";\nexport const v = s;\n` },
          { ...f("src/server/db/schema.ts", "platform", "persistence"), content: `export const s = 1;\n` },
        ],
      }),
  },
  {
    id: "NEG-06",
    expect: "fail",
    ruleHint: "CAPABILITY_DB_ACCESS",
    desc: "ai provider grabs db schema",
    setup: (root) =>
      writeFixture(root, {
        files: [
          { ...f("src/modules/ai/provider.ts", "ai", "capability"), content: `import { s } from "../../db/schema.js";\nexport const p = s;\n` },
          { ...f("src/db/schema.ts", "platform", "persistence"), content: `export const s = 1;\n` },
        ],
      }),
  },
  {
    id: "NEG-07",
    expect: "fail",
    ruleHint: "CROSS_OWNER_COLUMN_WRITE",
    desc: "characters repository writes copperBalance (owned by assets), no debt",
    setup: (root) =>
      writeFixture(root, {
        files: [
          {
            ...f("src/modules/characters/repo.ts", "characters", "persistence"),
            content: `import { characters } from "../../db/schema.js";\nexport class Repo {\n  async touch() {\n    await db.update(characters).set({ copperBalance: 5, hp: 3 });\n  }\n}\n`,
          },
          { ...f("src/db/schema.ts", "platform", "persistence"), content: `export const characters = {};\n` },
        ],
      }),
  },
  {
    id: "NEG-08",
    expect: "fail",
    ruleHint: "OWNERSHIP_UNCLASSIFIED_FILE",
    desc: "a new production file with no boundary entry",
    setup: (root) =>
      writeFixture(root, {
        files: [{ ...f("src/modules/npc/service.ts", "npc", "domain"), content: `export const s = 1;\n` }],
        unlisted: { "src/modules/npc/rogue.ts": `export const r = 2;\n` },
      }),
  },
  {
    id: "NEG-09",
    expect: "fail",
    ruleHint: "DISALLOWED_DEPENDENCY_EDGE",
    desc: "second unregistered cross-domain symbol in a legacy file (only first edge has debt)",
    setup: (root) =>
      writeFixture(root, {
        files: [
          {
            ...f("src/modules/npc/service.ts", "npc", "domain"),
            content: `import { x } from "../assets/vault.js";\nimport { y } from "../quests/task.js";\nexport const s = x + y;\n`,
          },
          { ...f("src/modules/assets/vault.ts", "assets", "persistence"), content: `export const x = 1;\n` },
          { ...f("src/modules/quests/task.ts", "quests", "persistence"), content: `export const y = 2;\n` },
        ],
        debt: {
          entries: [
            {
              id: "DEBT-T1",
              ruleId: "PEER_INTERNAL_IMPORT",
              source: "src/modules/npc/service.ts",
              target: "assets vault",
              symbol: "x",
              targetGlobs: ["src/modules/assets/vault.ts"],
            },
          ],
        },
      }),
  },
  {
    id: "NEG-10",
    expect: "fail",
    ruleHint: "DYNAMIC_NON_LITERAL_IMPORT",
    desc: "dynamic non-literal import in business code",
    setup: (root) =>
      writeFixture(root, {
        files: [
          { ...f("src/modules/npc/service.ts", "npc", "domain"), content: `const name = "./x.js";\nexport const load = () => import(name);\n` },
        ],
      }),
  },
  {
    id: "NEG-11",
    expect: "fail",
    ruleHint: "PURE_LAYER_IMPURIFY",
    desc: "pure rules module calls Date.now/Math.random",
    setup: (root) =>
      writeFixture(root, {
        files: [
          { ...f("packages/rules/core.ts", "rules", "rules"), content: `export const roll = () => Math.random() + Date.now();\n` },
        ],
      }),
  },
  {
    id: "NEG-12",
    expect: "pass",
    ruleHint: null,
    desc: "normal consumer of public API + own-module whitebox test both pass",
    setup: (root) =>
      writeFixture(root, {
        files: [
          { ...f("src/modules/npc/service.ts", "npc", "domain"), content: `import { coin } from "../assets/vault.js";\nexport const s = coin;\n` },
          { ...f("src/modules/assets/vault.ts", "assets", "persistence"), content: `export const coin = 1;\n` },
          { ...f("src/modules/npc/service.test.ts", "npc", "test", "test"), content: `import { s } from "./service.js";\nif (typeof s === "undefined") throw new Error("no");\n` },
        ],
        debt: {
          entries: [
            {
              id: "DEBT-T1",
              ruleId: "PEER_INTERNAL_IMPORT",
              source: "src/modules/npc/service.ts",
              target: "assets vault",
              symbol: "coin",
              targetGlobs: ["src/modules/assets/vault.ts"],
            },
          ],
        },
      }),
  },
];

// ---------- runner ----------

function runChecker(root) {
  try {
    const out = execFileSync(process.execPath, [CHECKER, "--root", root], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
    return { code: 0, out };
  } catch (err) {
    return { code: err.status ?? 1, out: err.stdout ?? "", err: err.stderr ?? "" };
  }
}

let failures = 0;
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "aimud-arch-fixtures-"));
console.log(`fixture root: ${tmp}`);
for (const fx of FIXTURES) {
  const dir = path.join(tmp, fx.id);
  fs.mkdirSync(dir, { recursive: true });
  fx.setup(dir);
  const { code, out } = runChecker(dir);
  const wentRed = code !== 0;
  const expectedRed = fx.expect === "fail";
  const ruleSeen = fx.ruleHint ? out.includes(fx.ruleHint) : true;
  const ok = wentRed === expectedRed && ruleSeen;
  console.log(`${ok ? "PASS" : "FAIL"}  ${fx.id}  expect=${fx.expect}  got=${wentRed ? "red" : "green"}${fx.ruleHint && wentRed ? `  ruleSeen=${ruleSeen}` : ""}  — ${fx.desc}`);
  if (!ok) {
    failures++;
    console.log(out.split("\n").filter((l) => l.startsWith("VIOLATION") || l.includes("RESULT")).join("\n"));
  }
}
console.log("-".repeat(72));
console.log(failures === 0 ? `arch:test PASS (${FIXTURES.length} fixtures)` : `arch:test FAIL (${failures}/${FIXTURES.length} fixtures misbehaved)`);
process.exit(failures === 0 ? 0 : 1);
