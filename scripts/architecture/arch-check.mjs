// pnpm arch:check — run the boundary checker against this repository.
// Exit 0 = only frozen-debt violations present (baseline); exit 1 = at least one
// uncovered violation. `--report <file>` writes the full JSON report.
import fs from "node:fs";
import path from "node:path";
import { analyze } from "./policy.mjs";

const args = process.argv.slice(2);
let rootDir = path.resolve(import.meta.dirname, "../..");
let reportFile = null;
for (let i = 0; i < args.length; i++) {
  if (args[i] === "--root") rootDir = path.resolve(args[++i]);
  else if (args[i] === "--report") reportFile = args[++i];
}
if (reportFile) reportFile = path.resolve(reportFile);
// dependency-cruiser resolves its input patterns against the process cwd;
// run with cwd = target root so relative config paths line up.
if (rootDir !== process.cwd()) process.chdir(rootDir);

const result = await analyze(rootDir);

if (reportFile) {
  fs.writeFileSync(path.resolve(reportFile), JSON.stringify(result, null, 2) + "\n");
}

const line = "-".repeat(72);
console.log(line);
console.log(`arch:check  root=${path.relative(process.cwd(), rootDir) || "."}`);
console.log(
  `files on disk: ${result.summary.filesOnDisk}  classified: ${result.summary.classified}  ` +
    `debt-matched: ${result.summary.debtMatched} (of ${result.summary.debtIds.length} debt entries)  ` +
    `UNCOVERED violations: ${result.summary.violations}`
);
if (result.violations.length > 0) {
  console.log(line);
  for (const v of result.violations) {
    console.log(`VIOLATION ${v.rule}`);
    console.log(`  at   ${v.from}`);
    if (v.toPath) console.log(`  to   ${v.toPath}`);
    if (v.to && !v.toPath) console.log(`  to   ${v.to}`);
    if (v.table) console.log(`  fact ${v.table}.${v.column} (owner side: ${v.message})`);
    console.log(`  why  ${v.message}`);
  }
}
console.log(line);
console.log(result.ok ? "RESULT: PASS (baseline clean, debts accounted)" : "RESULT: FAIL");
process.exit(result.ok ? 0 : 1);
