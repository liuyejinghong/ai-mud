import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { WorldResetAdmin } from "./WorldResetAdmin";

describe("WorldResetAdmin", () => {
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("requires the fixed confirmation phrase before enabling reset", () => {
    vi.stubGlobal("fetch", vi.fn());

    render(<WorldResetAdmin csrfToken="csrf-token" />);

    const resetButton = screen.getByRole("button", { name: "重置黑松世界" });
    expect(resetButton).toHaveProperty("disabled", true);

    fireEvent.change(screen.getByLabelText("重置原因"), {
      target: { value: "经济系统崩溃后重置" }
    });
    fireEvent.change(screen.getByLabelText("确认短语"), {
      target: { value: "RESET WORLD" }
    });
    expect(resetButton).toHaveProperty("disabled", true);

    fireEvent.change(screen.getByLabelText("确认短语"), {
      target: { value: "RESET BLACKPINE" }
    });
    expect(resetButton).toHaveProperty("disabled", false);
  });

  it("posts the audited world reset request with the admin CSRF token", async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      json: async () => ({
        ok: true,
        mode: "world_reset",
        resetAt: "2026-07-05T12:00:00.000Z",
        clearedTables: ["characters", "world_actors"],
        message: "世界已重置并完成基础初始化。"
      })
    }));
    vi.stubGlobal("fetch", fetchMock);

    render(<WorldResetAdmin csrfToken="csrf-token" />);

    fireEvent.change(screen.getByLabelText("重置原因"), {
      target: { value: "经济系统崩溃后重置" }
    });
    fireEvent.change(screen.getByLabelText("确认短语"), {
      target: { value: "RESET BLACKPINE" }
    });
    fireEvent.click(screen.getByRole("button", { name: "重置黑松世界" }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        "http://127.0.0.1:3000/admin/world-reset",
        expect.objectContaining({
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-ai-mud-csrf": "csrf-token"
          },
          body: JSON.stringify({
            confirmationText: "RESET BLACKPINE",
            reason: "经济系统崩溃后重置"
          })
        })
      );
    });
    expect(await screen.findByText("世界已重置：2026-07-05T12:00:00.000Z")).toBeTruthy();
  });
});
