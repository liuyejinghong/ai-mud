import { cleanup, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import { NpcMemoryAdmin } from "./NpcMemoryAdmin";
import type { NpcMemoryResponse } from "./adminApi";

const snapshot: NpcMemoryResponse = {
  generatedAt: "2026-07-02T08:30:00.000Z",
  entries: [
    {
      id: "mem-1",
      npcActorId: "npc-blacksmith",
      characterId: "char-1",
      sourceType: "dialogue",
      memoryKind: "conversation",
      evidenceLevel: "dialogue_claim",
      sourceIds: ["msg-1", "msg-2"],
      importance: 2,
      summary: "阿岚询问铁矿石。",
      occurredAt: "2026-07-02T08:00:00.000Z",
      compressedAt: null
    }
  ],
  fragments: [
    {
      id: "frag-1",
      npcActorId: "npc-blacksmith",
      characterId: "char-1",
      memoryKind: "conversation",
      evidenceLevel: "dialogue_claim",
      importance: 2,
      summary: "阿岚多次询问铁矿石。",
      firstOccurredAt: "2026-07-02T08:00:00.000Z",
      lastOccurredAt: "2026-07-02T09:00:00.000Z",
      sourceEntryIds: ["mem-1"],
      compressionLevel: 1
    }
  ]
};

describe("NpcMemoryAdmin", () => {
  beforeEach(() => {
    cleanup();
  });

  it("renders NPC memory entries and fragments", () => {
    render(<NpcMemoryAdmin initialSnapshot={snapshot} />);

    expect(screen.getByRole("heading", { name: "NPC 记忆" })).toBeTruthy();
    expect(screen.getByText("短期 1 条 · 碎片 1 条")).toBeTruthy();
    expect(screen.getByText("阿岚询问铁矿石。")).toBeTruthy();
    expect(screen.getByText("阿岚多次询问铁矿石。")).toBeTruthy();
    expect(screen.getAllByText("对话声称")).toHaveLength(2);
    expect(screen.getByText("未压缩")).toBeTruthy();
    expect(screen.getByText("L1")).toBeTruthy();
  });
});
