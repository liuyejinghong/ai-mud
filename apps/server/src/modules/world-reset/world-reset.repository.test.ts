import { describe, expect, it } from "vitest";
import { worldRuntimeState } from "../../db/schema.js";
import { WorldResetRepository } from "./world-reset.repository.js";

// 车道 C2（ARCH-boundaries-01）：旧世界重置曾把共享 tick 时钟行写成 1970-01-01，
// 此后每个世界 tick 步都被基地判为追补步（只推时钟、不生产）。
// 重置后的时钟必须对齐到重置时刻所在的 tick，而不是纪元 0。

interface RecordedInsert {
  table: unknown;
  values: Record<string, unknown>;
}

function createRecordingDb(existingEpoch: number | null) {
  const inserts: RecordedInsert[] = [];
  const db = {
    update: () => ({ set: async () => undefined }),
    delete: async () => undefined,
    select: () => ({
      from: () => ({
        limit: async () => (existingEpoch === null ? [] : [{ worldEpoch: existingEpoch }])
      })
    }),
    insert: (table: unknown) => ({
      values: async (values: Record<string, unknown>) => {
        inserts.push({ table, values });
      }
    })
  };
  return { db, inserts };
}

describe("WorldResetRepository.resetWorldState", () => {
  it("re-creates the runtime clock row at the reset tick instead of the Unix epoch", async () => {
    const { db, inserts } = createRecordingDb(4);
    const repository = new WorldResetRepository(db as unknown as ConstructorParameters<typeof WorldResetRepository>[0]);

    await repository.resetWorldState({ resetAt: new Date("2026-09-25T08:17:42.500Z") });

    const runtimeInserts = inserts.filter((insert) => insert.table === worldRuntimeState);
    expect(runtimeInserts).toHaveLength(1);
    expect(runtimeInserts[0]?.values).toEqual({
      key: "npc_world",
      lastSettledAt: new Date("2026-09-25T08:17:00.000Z"),
      worldEpoch: 5
    });
  });

  it("starts the epoch at 1 when no runtime row existed", async () => {
    const { db, inserts } = createRecordingDb(null);
    const repository = new WorldResetRepository(db as unknown as ConstructorParameters<typeof WorldResetRepository>[0]);

    await repository.resetWorldState({ resetAt: new Date("2026-09-25T08:00:00.000Z") });

    const runtimeInsert = inserts.find((insert) => insert.table === worldRuntimeState);
    expect(runtimeInsert?.values).toEqual({
      key: "npc_world",
      lastSettledAt: new Date("2026-09-25T08:00:00.000Z"),
      worldEpoch: 1
    });
  });
});
