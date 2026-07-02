import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

interface Journal {
  entries: Array<{ idx: number; tag: string }>;
}

const drizzleDir = join(process.cwd(), "drizzle");

function readJournal() {
  return JSON.parse(
    readFileSync(join(drizzleDir, "meta", "_journal.json"), "utf8")
  ) as Journal;
}

describe("drizzle migration journal", () => {
  it("tracks every migration SQL file in order", () => {
    const sqlTags = readdirSync(drizzleDir)
      .filter((file) => /^\d{4}_.+\.sql$/.test(file))
      .map((file) => file.replace(/\.sql$/, ""))
      .sort();
    const journalTags = readJournal()
      .entries.sort((left, right) => left.idx - right.idx)
      .map((entry) => entry.tag);

    expect(journalTags).toEqual(sqlTags);
  });
});
