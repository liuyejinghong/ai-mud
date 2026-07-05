import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SystemAnnouncementAdmin } from "./SystemAnnouncementAdmin";

describe("SystemAnnouncementAdmin", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("publishes a bounded system announcement with the admin CSRF token", async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      json: async () => ({
        id: "announcement-1",
        characterId: "system",
        characterName: "系统公告",
        kind: "system",
        channel: "lobby",
        body: "今晚 22:00 将进行世界重置演练。",
        createdAt: "2026-07-05T12:00:00.000Z"
      })
    }));
    vi.stubGlobal("fetch", fetchMock);

    render(<SystemAnnouncementAdmin csrfToken="csrf-token" />);

    fireEvent.change(screen.getByLabelText("公告内容"), {
      target: { value: "今晚 22:00 将进行世界重置演练。" }
    });
    fireEvent.click(screen.getByRole("button", { name: "发布到大厅" }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        "http://127.0.0.1:3000/admin/announcements",
        expect.objectContaining({
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-ai-mud-csrf": "csrf-token"
          },
          body: JSON.stringify({ body: "今晚 22:00 将进行世界重置演练。" })
        })
      );
    });
    expect(await screen.findByText("公告已发布")).toBeTruthy();
  });
});
