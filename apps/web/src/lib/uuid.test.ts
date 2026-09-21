import { afterEach, describe, expect, it, vi } from "vitest";
import { newCommandId } from "./uuid.js";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("newCommandId（TECH-01：非安全上下文回退）", () => {
  it("安全上下文直接用 crypto.randomUUID", () => {
    vi.stubGlobal("crypto", { randomUUID: () => "native-uuid" });
    expect(newCommandId()).toBe("native-uuid");
  });

  it("非安全上下文（无 randomUUID）回退 getRandomValues，产出合法 v4 格式且不重复", () => {
    const realGetRandomValues = globalThis.crypto.getRandomValues.bind(globalThis.crypto);
    vi.stubGlobal("crypto", {
      getRandomValues: <T extends ArrayBufferView>(array: T): T => realGetRandomValues(array)
    });
    const ids = new Set<string>();
    const pattern = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
    for (let i = 0; i < 50; i++) {
      const id = newCommandId();
      expect(id).toMatch(pattern);
      ids.add(id);
    }
    expect(ids.size).toBe(50);
  });
});
