// MOD-02 boundary checker core library.
// Rules are DERIVED from the frozen contracts (docs/architecture/module-catalog.json,
// module-boundaries.json, legacy-boundary-debt.json) — never hand-copied — so the
// config cannot drift from the contract (M02 acceptance requirement).
// No game code may import this file; it is tooling only.
import fs from "node:fs";
import path from "node:path";
import { cruise } from "dependency-cruiser";

export const RULES = {
  UNCLASSIFIED_FILE: "OWNERSHIP_UNCLASSIFIED_FILE",
  DISALLOWED_EDGE: "DISALLOWED_DEPENDENCY_EDGE",
  DISALLOWED_PACKAGE_EDGE: "DISALLOWED_PACKAGE_EDGE",
  CYCLE: "MODULE_CYCLE",
  PURE_LAYER_IMPURIFY: "PURE_LAYER_IMPURIFY",
  CLIENT_SERVER_BOUNDARY: "CLIENT_SERVER_BOUNDARY",
  CAPABILITY_DB_ACCESS: "CAPABILITY_DB_ACCESS",
  TRANSPORT_DB_ACCESS: "TRANSPORT_DB_ACCESS",
  DYNAMIC_IMPORT: "DYNAMIC_NON_LITERAL_IMPORT",
  PUBLIC_LEAK: "PUBLIC_WILDCARD_OR_ORM_LEAK",
  COLUMN_OWNERSHIP: "CROSS_OWNER_COLUMN_WRITE",
  UNANALYZABLE_SQL_WRITE: "UNANALYZABLE_SQL_WRITE",
};

// Workspace package -> logical modules its files belong to (mirrors module-boundaries.json).
const PACKAGE_MODULES = {
  "@ai-mud/shared": ["kernel", "protocol"],
  "@ai-mud/content": ["content"],
  "@ai-mud/game-rules": ["rules"],
  "@ai-mud/ai-prompts": ["ai"],
};
// While the shared barrel is unpartitioned (frozen transitional debt DEBT-026),
// importing @ai-mud/shared only requires `kernel` to be allowed; the protocol
// share of the barrel is covered by DEBT-026.
const SHARED_BARREL_DEBT_ID = "DEBT-026";

const CLIENT_MODULES = new Set(["client_session", "client_text", "client_pixel"]);
const PURE_MODULES = new Set(["kernel", "content", "rules", "protocol"]);

export function loadInputs(rootDir) {
  const read = (p) => JSON.parse(fs.readFileSync(path.join(rootDir, p), "utf8"));
  return {
    catalog: read("docs/architecture/module-catalog.json"),
    boundaries: read("docs/architecture/module-boundaries.json"),
    debt: read("docs/architecture/legacy-boundary-debt.json"),
  };
}

export function listSourceFiles(rootDir) {
  const out = [];
  const walk = (dir) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) {
        if (e.name === "node_modules" || e.name === "dist" || e.name === ".git") continue;
        walk(p);
      } else if (/\.(ts|tsx)$/.test(e.name)) out.push(path.relative(rootDir, p));
    }
  };
  for (const top of ["apps", "packages", "src"]) {
    const abs = path.join(rootDir, top);
    if (fs.existsSync(abs)) walk(abs);
  }
  return out.sort();
}

// ---------- debt matching ----------

function expandDebtGlobs(entry) {
  const pats = entry.targetGlobs ?? [];
  return pats.map((g) => globToRegExp(path.posix.normalize(g)));
}

function globToRegExp(glob) {
  const esc = glob
    .replace(/[.+^${}()|[\]\\]/g, "\\$&") // escapes braces to \{ \} as well
    .replace(/\\{([^}]+)\\\}/g, (_, alt) => "(?:" + alt.split(",").join("|") + ")") // expand alternation after escaping
    .replace(/\*\*/g, "\u0000")
    .replace(/\*/g, "[^/]*")
    .replace(/\u0000/g, ".*");
  return new RegExp(`^${esc}$`);
}

function entryMentionsFile(entry, filePath) {
  const hay = [entry.source ?? "", entry.target ?? "", entry.symbol ?? "", entry.evidence ?? ""].join(" ");
  const base = path.basename(filePath).replace(/\.tsx?$/, "");
  return hay.includes(filePath) || hay.includes(base);
}

function snakeToCamel(s) {
  return s.replace(/_([a-z])/g, (_, c) => c.toUpperCase());
}

export function matchDebtEntry(entry, v) {
  const globs = expandDebtGlobs(entry);
  switch (v.rule) {
    case RULES.DISALLOWED_EDGE:
    case RULES.DISALLOWED_PACKAGE_EDGE: {
      if (!edgeRuleIds(entry).has(v.rule)) return false;
      if (!entryMatchesSource(entry, v.from)) return false;
      if (v.rule === RULES.DISALLOWED_PACKAGE_EDGE) {
        return globs.length > 0 && globs.some((re) => re.test(v.to ?? "")) && (entry.symbol ?? "").includes(v.toPackage ?? "");
      }
      if (globs.length > 0) return globs.some((re) => re.test(v.toPath ?? ""));
      return entryMentionsFile(entry, v.toPath ?? "");
    }
    case RULES.CYCLE: {
      return entry.coveredModuleEdges?.includes(`${v.from}>${v.to}`) ?? false;
    }
    case RULES.UNANALYZABLE_SQL_WRITE: {
      return edgeRuleIds(entry).has(RULES.UNANALYZABLE_SQL_WRITE) && entryMentionsFile(entry, v.from);
    }
    case RULES.COLUMN_OWNERSHIP: {
      if (edgeRuleIds(entry).has(RULES.COLUMN_OWNERSHIP) === false) return false;
      const srcNorm = snakeToCamel(String(entry.source ?? ""));
      const tbl = snakeToCamel(v.table);
      if (!srcNorm.includes(tbl)) return false;
      if (!entryMentionsFile(entry, v.from)) return false;
      const colVariants = [v.column, snakeToCamel(v.column)];
      return colVariants.some((c) => srcNorm.includes(c) || (entry.symbol ?? "").includes(c));
    }
    default:
      return false;
  }
}

function edgeRuleIds(entry) {
  const set = new Set();
  const r = String(entry.ruleId ?? "");
  const alias = {
    PEER_PERSISTENCE_IMPORT: RULES.DISALLOWED_EDGE,
    PEER_INTERNAL_IMPORT: RULES.DISALLOWED_EDGE,
    TYPE_ONLY_PEER_IMPORT: RULES.DISALLOWED_EDGE,
    REPO_INSTANTIATES_PEER_SERVICE: RULES.DISALLOWED_EDGE,
    TRANSPORT_IMPORTS_BUSINESS_INTERNAL: RULES.DISALLOWED_EDGE,
    READ_MODEL_IMPORTS_BUSINESS_INTERNAL: RULES.DISALLOWED_EDGE,
    BUSINESS_IMPORTS_AI_DIRECT: RULES.DISALLOWED_EDGE,
    MODULE_LEVEL_CYCLE: RULES.CYCLE,
    CROSS_OWNER_COLUMN_WRITE: RULES.COLUMN_OWNERSHIP,
    CROSS_OWNER_TABLE_WRITE: RULES.COLUMN_OWNERSHIP,
    WORLD_RESOURCE_OWNER_REASSIGN: RULES.COLUMN_OWNERSHIP,
    AI_AUDIT_WRITER_MISPLACED: RULES.COLUMN_OWNERSHIP,
    PROD_IMPORTS_SIMULATION_FIXTURE: RULES.DISALLOWED_EDGE,
    TEST_CROSS_MODULE_FIXTURE: RULES.DISALLOWED_EDGE,
    UNANALYZABLE_SQL_WRITE: RULES.UNANALYZABLE_SQL_WRITE,
    PUBLIC_WILDCARD_REEXPORT: RULES.PUBLIC_LEAK,
  };
  if (alias[r]) set.add(alias[r]);
  return set;
}

function entryMatchesSource(entry, filePath) {
  const s = entry.source ?? "";
  if (s.includes(filePath)) return true;
  const base = path.basename(filePath);
  return s.includes(base);
}

export function findDebtAllowance(debt, violation) {
  return debt.entries.find((e) => matchDebtEntry(e, violation)) ?? null;
}

// ---------- checks ----------

export function coverageCheck(filesOnDisk, boundaries) {
  const known = new Map();
  for (const f of boundaries.files) known.set(f.path, (known.get(f.path) ?? 0) + 1);
  const violations = [];
  const dupes = [];
  for (const [p, n] of known) if (n > 1) dupes.push(p);
  for (const f of filesOnDisk) {
    if (!known.has(f)) {
      violations.push({
        rule: RULES.UNCLASSIFIED_FILE,
        from: f,
        message: "file exists on disk but has no entry in module-boundaries.json (fail closed)",
      });
    }
  }
  return { violations, dupes };
}

function normalizeTarget(rootDir, resolved) {
  let p = resolved;
  const nm = p.match(/node_modules\/(@ai-mud\/[^/]+)/);
  if (nm) return { packageEdge: nm[1] };
  if (path.isAbsolute(p)) {
    if (p.startsWith(rootDir)) p = path.relative(rootDir, p);
  }
  return { path: p.split(path.sep).join("/") };
}

export async function runCruise(rootDir) {
  const options = {
    doNotFollow: { path: "node_modules" },
    tsPreCompilationDeps: true,
    combinedDependencies: true,
    moduleSystems: ["es6", "cjs"],
    outputType: "json",
    exclude: { path: "(^|/)dist/|(^|/)node_modules/" },
  };
  const tsBase = path.join(rootDir, "tsconfig.base.json");
  if (fs.existsSync(tsBase)) options.tsConfig = { fileName: tsBase };
  const tops = ["apps", "packages", "scripts", "src"].filter((d) => fs.existsSync(path.join(rootDir, d)));
  if (tops.length === 0) return { modules: [] };
  const result = await cruise(tops, options);
  return JSON.parse(result.output);
}

export function edgeCheck(cruiseOutput, rootDir, boundaries, catalog, debt) {
  const index = new Map(boundaries.files.map((f) => [f.path, f]));
  const moduleOf = (p) => index.get(p)?.module ?? null;
  const allowed = new Map(catalog.modules.map((m) => [m.id, new Set(m.allowedDependencies)]));
  const violations = [];
  const matched = [];
  const moduleEdges = new Set(); // "srcModule>dstModule" for cycle check (production only)

  for (const mod of cruiseOutput.modules ?? []) {
    const fromRel = mod.source.split(path.sep).join("/");
    const fromMeta = index.get(fromRel);
    if (!fromMeta) continue; // non-source or external
    if (fromMeta.scope === "tooling" || fromMeta.scope === "config") continue;
    for (const dep of mod.dependencies ?? []) {
      const t = normalizeTarget(rootDir, dep.resolved);
      const toRel = t.path;
      const toMeta = toRel ? index.get(toRel) : undefined;

      // package-level edge (@ai-mud/*)
      if (t.packageEdge) {
        const targets = PACKAGE_MODULES[t.packageEdge];
        if (!targets) continue; // external npm dependency — not part of the boundary graph
        if (t.packageEdge === "@ai-mud/shared") {
          if (allowed.get(fromMeta.module)?.has("kernel")) continue; // incl. barrel debt DEBT-026
        } else if (targets.every((m) => allowed.get(fromMeta.module)?.has(m))) {
          continue;
        }
        const v = {
          rule: RULES.DISALLOWED_PACKAGE_EDGE,
          from: fromRel,
          toPackage: t.packageEdge,
          to: `${fromMeta.module} -> ${t.packageEdge} (${targets.join("/")})`,
          message: "workspace package target module not in catalog allowedDependencies",
        };
        const allowance = findDebtAllowance(debt, v);
        allowance ? matched.push({ ...v, debtId: allowance.id }) : violations.push(v);
        continue;
      }

      if (!toMeta) continue; // unresolved/external
      if (fromMeta.scope === "test" || toMeta.scope === "test") {
        // test graph: own module + shared contracts/platform/pure layers + the client
        // session (web-side public surface) are allowed; anything else is registered fixture debt
        const ok =
          toMeta.module === fromMeta.module ||
          ["kernel", "protocol", "platform", "content", "rules", "client_session"].includes(toMeta.module) ||
          fromMeta.module === "composition" ||
          fromMeta.module === "application";
        if (!ok) {
          const v = {
            rule: RULES.DISALLOWED_EDGE,
            from: fromRel,
            toPath: toRel,
            to: `${fromMeta.module} -> ${toMeta.module}`,
            message: "test file crosses business module boundary",
          };
          const allowance = findDebtAllowance(debt, v);
          allowance ? matched.push({ ...v, debtId: allowance.id }) : violations.push(v);
        }
        continue;
      }

      // production graph
      const isAllowed =
        fromMeta.module === toMeta.module || // intra-module wiring is not a boundary crossing
        (allowed.get(fromMeta.module)?.has(toMeta.module) ?? false);
      if (!isAllowed) {
        const v = {
          rule: RULES.DISALLOWED_EDGE,
          from: fromRel,
          toPath: toRel,
          to: `${fromMeta.module} -> ${toMeta.module}`,
          message: "dependency edge not in catalog allowedDependencies",
        };
        const allowance = findDebtAllowance(debt, v);
        allowance ? matched.push({ ...v, debtId: allowance.id }) : violations.push(v);
      }
      if (fromMeta.module !== toMeta.module) {
        moduleEdges.add(`${fromMeta.module}>${toMeta.module}`);
      }
    }
  }
  return { violations, matched, moduleEdges };
}

export function cycleCheck(moduleEdges, catalog, debt) {
  // The contract's no-cycle rule is about the BUSINESS dependency graph
  // (catalog: "业务依赖有向无环"); composition/transport/application/client hubs
  // legitimately import many modules and are out of scope for this rule.
  const business = new Set(catalog.modules.filter((m) => m.kind === "business").map((m) => m.id));
  const adj = new Map();
  for (const e of moduleEdges) {
    const [a, b] = e.split(">");
    if (!business.has(a) || !business.has(b)) continue;
    (adj.get(a) ?? adj.set(a, new Set()).get(a)).add(b);
  }
  const cycles = [];
  const state = new Map();
  const stack = [];
  const dfs = (n) => {
    state.set(n, 1);
    stack.push(n);
    for (const m of adj.get(n) ?? []) {
      if ((state.get(m) ?? 0) === 0) dfs(m);
      else if (state.get(m) === 1) {
        const i = stack.indexOf(m);
        cycles.push(stack.slice(i));
      }
    }
    stack.pop();
    state.set(n, 2);
  };
  for (const n of adj.keys()) if ((state.get(n) ?? 0) === 0) dfs(n);
  // every edge in the cycle must be debt-covered to be tolerated
  const violations = [];
  const matched = [];
  for (const cyc of cycles) {
    const edges = [];
    for (let i = 0; i < cyc.length; i++) {
      const a = cyc[i];
      const b = cyc[(i + 1) % cyc.length];
      edges.push(`${a}>${b}`);
    }
    const uncovered = edges.filter((e) => {
      const [a, b] = e.split(">");
      const v = { rule: RULES.CYCLE, from: a, to: b, toPath: b, message: "module cycle" };
      return !findDebtAllowance(debt, v);
    });    const rec = { rule: RULES.CYCLE, cycle: cyc.join(" -> "), edges, uncovered };
    uncovered.length === 0 ? matched.push(rec) : violations.push(rec);
  }
  return { violations, matched };
}

function readFileSafe(rootDir, rel) {
  try {
    return fs.readFileSync(path.join(rootDir, rel), "utf8");
  } catch {
    return "";
  }
}

export function purityCheck(rootDir, boundaries) {
  const violations = [];
  for (const f of boundaries.files) {
    if (f.scope !== "production" || !PURE_MODULES.has(f.module)) continue;
    const src = readFileSafe(rootDir, f.path);
    const bans = [
      [/\bDate\.now\s*\(/, "Date.now()"],
      [/\bMath\.random\s*\(/, "Math.random()"],
      [/\bfetch\s*\(/, "fetch()"],
      [/\bnew Date\s*\(\s*\)/, "new Date() (system clock)"],
      [/from\s+["'](node:)?(fs|path|http|https|net|crypto)["']/, "node builtin import"],
      [/from\s+["'][^"']*db\/(schema|client)\.js?["']/, "db import in pure layer"],
    ];
    for (const [re, what] of bans) {
      if (re.test(src)) {
        violations.push({ rule: RULES.PURE_LAYER_IMPURIFY, from: f.path, to: what, message: `pure layer module uses ${what}` });
      }
    }
  }
  return violations;
}

export function layerRestrictionChecks(rootDir, boundaries, cruiseOutput) {
  const violations = [];
  const index = new Map(boundaries.files.map((f) => [f.path, f]));
  for (const mod of cruiseOutput.modules ?? []) {
    const rel = mod.source.split(path.sep).join("/");
    const meta = index.get(rel);
    if (!meta || meta.scope !== "production") continue;
    const src = readFileSafe(rootDir, rel);
    // NEG-10: dynamic non-literal import
    if (/\bimport\s*\(\s*[^"'`]/.test(src)) {
      violations.push({ rule: RULES.DYNAMIC_IMPORT, from: rel, to: "(dynamic import)", message: "non-literal dynamic import is banned" });
    }
    // NEG-05: client importing server-side code
    if (CLIENT_MODULES.has(meta.module)) {
      for (const dep of mod.dependencies ?? []) {
        const t = normalizeTarget(rootDir, dep.resolved);
        if (t.path && (t.path.startsWith("apps/server/") || /\/server\//.test(t.path))) {
          violations.push({ rule: RULES.CLIENT_SERVER_BOUNDARY, from: rel, toPath: t.path, message: "client module imports server code" });
        }
        if (/\bfrom\s+["']node:/.test(src)) {
          violations.push({ rule: RULES.CLIENT_SERVER_BOUNDARY, from: rel, to: "node builtin", message: "client module imports node builtin" });
          break;
        }
      }
    }
    // NEG-06: ai capability must not touch DB
    if (meta.module === "ai" && /from\s+["'][^"']*db\/(schema|client)\.js?["']/.test(src)) {
      violations.push({ rule: RULES.CAPABILITY_DB_ACCESS, from: rel, to: "db", message: "ai capability imports database" });
    }
    // transport must not touch DB directly
    if (meta.layer === "transport" && /from\s+["'][^"']*db\/(schema|client)\.js?["']/.test(src)) {
      violations.push({ rule: RULES.TRANSPORT_DB_ACCESS, from: rel, to: "db", message: "transport imports database" });
    }
    // NEG-03: public entry leaks
    if (path.basename(rel) === "public.ts" && /export\s+\*/.test(src)) {
      violations.push({ rule: RULES.PUBLIC_LEAK, from: rel, to: "export *", message: "public entry uses wildcard re-export" });
    }
  }
  return violations;
}

// Column ownership map: derived from modularity.md §7 + frozen adjudications
// (module-boundary-inventory.md §2). Only restricted columns are listed;
// unlisted table/column pairs are not owned-checked (documented limitation).
export const COLUMN_OWNERSHIP = {
  characters: { copperBalance: "assets" },
  worldActors: { copperBalance: "assets" },
  municipalTreasury: { copperBalance: "assets" },
  marketInventory: { quantity: "assets" },
  characterItems: { quantity: "assets" },
  npcItems: { quantity: "assets" },
  itemInstances: { currentDurability: "assets", maxDurability: "assets" },
  characterEquipment: { currentDurability: "assets", maxDurability: "assets" },
  mapInstances: { resourceCharges: "characters" },
  npcTasks: { escrowCopper: "assets", rewardCopper: "assets" },
  worldResourceNodes: { charges: "world" },
};

const DRIZZLE_HELPERS = new Set(["if", "for", "while", "switch", "catch", "return", "function", "and", "or", "not", "eq", "gte", "lte", "gt", "lt", "sql", "inArray", "isNull", "desc", "asc", "count"]);

function enclosingFunction(src, offset) {
  const upTo = src.slice(0, offset);
  const lines = upTo.split("\n");
  for (let i = lines.length - 1; i >= Math.max(0, lines.length - 200); i--) {
    const m = lines[i].match(/^\s+(?:private\s+|public\s+|protected\s+)?(?:async\s+)?([A-Za-z_$][\w$]*)\s*\(/);
    if (m && !DRIZZLE_HELPERS.has(m[1])) return m[1];
  }
  return "(unknown)";
}

export function columnWriteCheck(rootDir, boundaries, debt) {
  const index = new Map(boundaries.files.map((f) => [f.path, f]));
  const violations = [];
  const matched = [];
  const pushWithDebtCheck = (v) => {
    const allowance = findDebtAllowance(debt, v);
    allowance ? matched.push({ ...v, debtId: allowance.id }) : violations.push(v);
  };
  for (const f of boundaries.files) {
    if (f.scope !== "production") continue;
    if (!["persistence", "domain", "application"].includes(f.layer)) continue;
    const src = readFileSafe(rootDir, f.path);
    if (!src.includes(".set(")) continue;
    const setterRe = /\.set\s*\(/g;
    let m;
    while ((m = setterRe.exec(src)) !== null) {
      // only UPDATE setters are writes; Map.set / DOM-ish .set calls are ignored.
      const window = src.slice(Math.max(0, m.index - 240), m.index);
      if (!/\.update\s*\(\s*[A-Za-z_$][\w$]*\s*\)[\s.]*$/.test(window)) continue;
      const start = m.index + m[0].length;
      const depthEnd = matchBrace(src, start - 1);
      if (depthEnd === null) {
        pushWithDebtCheck({ rule: RULES.UNANALYZABLE_SQL_WRITE, from: f.path, to: ".set()", message: ".set() block could not be analyzed — requires manual review" });
        continue;
      }
      // find the table this setter targets: nearest preceding .update(<ident>)
      const before = src.slice(0, m.index);
      const um = before.match(/\.update\s*\(\s*([A-Za-z_$][\w$]*)\s*\)(?![\s\S]*\.update\s*\(\s*[A-Za-z_$][\w$]*\s*\)[\s\S]*$)/);
      const body = src.slice(start, depthEnd);
      if (/[.]{3}|\[\s*[^\]"']+\]/.test(body)) {
        pushWithDebtCheck({ rule: RULES.UNANALYZABLE_SQL_WRITE, from: f.path, to: enclosingFunction(src, m.index), message: "spread/computed key in .set() — requires manual review" });
        continue;
      }
      if (!um) continue;
      const table = um[1];
      const ownerMap = COLUMN_OWNERSHIP[table];
      if (!ownerMap) continue;
      const keys = [...body.matchAll(/(?:^|[,{]\s*)([A-Za-z_$][\w$]*)\s*:/g)].map((x) => x[1]);
      for (const key of keys) {
        const owner = ownerMap[key];
        if (!owner) continue;
        if (f.module === owner) continue;
        const v = {
          rule: RULES.COLUMN_OWNERSHIP,
          from: f.path,
          to: enclosingFunction(src, m.index),
          table,
          column: key,
          message: `${f.module} writes ${table}.${key} owned by ${owner}`,
        };
        const allowance = findDebtAllowance(debt, v);
        allowance ? matched.push({ ...v, debtId: allowance.id }) : violations.push(v);
      }
    }
  }
  return { violations, matched };
}

function matchBrace(src, openIdx) {
  let depth = 0;
  for (let i = openIdx; i < src.length; i++) {
    const c = src[i];
    if (c === "{") depth++;
    else if (c === "}") {
      depth--;
      if (depth === 0) return i;
    }
  }
  return null;
}

// ---------- main ----------

export async function analyze(rootDir) {
  const { catalog, boundaries, debt } = loadInputs(rootDir);
  const filesOnDisk = listSourceFiles(rootDir);
  const coverage = coverageCheck(filesOnDisk, boundaries);
  const violations = [...coverage.violations];
  const matched = coverage.dupes.map((p) => ({ rule: "DUPLICATE_OWNERSHIP", from: p }));

  let cruiseOutput = { modules: [] };
  try {
    cruiseOutput = await runCruise(rootDir);
  } catch (err) {
    violations.push({ rule: "CRUISE_FAILURE", from: "(graph)", to: String(err?.message ?? err), message: "dependency graph extraction failed" });
  }

  const edges = edgeCheck(cruiseOutput, rootDir, boundaries, catalog, debt);
  violations.push(...edges.violations);
  matched.push(...edges.matched);

  const cycles = cycleCheck(edges.moduleEdges, catalog, debt);
  violations.push(...cycles.violations);
  matched.push(...cycles.matched);

  violations.push(...purityCheck(rootDir, boundaries));
  violations.push(...layerRestrictionChecks(rootDir, boundaries, cruiseOutput));

  const cols = columnWriteCheck(rootDir, boundaries, debt);
  violations.push(...cols.violations);
  matched.push(...cols.matched);

  violations.sort((a, b) => (a.rule + a.from + (a.to ?? "")).localeCompare(b.rule + b.from + (b.to ?? "")));
  matched.sort((a, b) => (a.rule + a.from + (a.to ?? "")).localeCompare(b.rule + b.from + (b.to ?? "")));

  return {
    ok: violations.length === 0,
    summary: {
      filesOnDisk: filesOnDisk.length,
      classified: boundaries.files.length,
      violations: violations.length,
      debtMatched: matched.length,
      debtIds: [...new Set(matched.map((m) => m.debtId).filter(Boolean))],
    },
    violations,
    debtMatched: matched,
  };
}
