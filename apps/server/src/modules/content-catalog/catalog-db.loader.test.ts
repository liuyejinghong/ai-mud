import { describe, expect, it } from "vitest";
import type { Db } from "../../db/client.js";
import { loadReleaseCatalog } from "./catalog-db.loader.js";

describe("loadReleaseCatalog", () => {
  it("内置旧档与教程档可直接装载，未知 release 显式拒绝", async () => {
    const db = {
      select: () => ({ from: () => ({ where: () => ({ limit: async () => [] }) }) })
    } as unknown as Pick<Db, "select">;

    expect((await loadReleaseCatalog(db, "yudian-base-0")).releaseId()).toBe("yudian-base-0");
    const tutorial = await loadReleaseCatalog(db, "yudian-base-tutorial-1");
    expect(tutorial.getRecipeTemplate("manufacture-yd-h1")?.ref.revision).toBe(2);
    await expect(loadReleaseCatalog(db, "missing-release")).rejects.toThrow("Unknown content release: missing-release");
  });
});
