// D013-ui：事件记录面板。按冻结契约 1 mock 端点（A 线并行实现，类型本地声明）。
import { render, screen, waitFor, cleanup } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EventsPanel } from "./EventsPanel.js";
import { getBaseEvents, BaseApiError } from "./baseApi.js";

vi.mock("./baseApi.js", () => ({
  BaseApiError: class BaseApiError extends Error {
    constructor(
      readonly status: number,
      readonly code: string,
      message: string
    ) {
      super(message);
    }
  },
  getBaseEvents: vi.fn()
}));

function event(overrides: Partial<{ id: string; type: string; title: string; detail: string; simTime: string; createdAt: string }> = {}) {
  return {
    id: overrides.id ?? "e-1",
    type: overrides.type ?? "project.completed",
    title: overrides.title ?? "安装首座太阳能已完工",
    detail: overrides.detail ?? "发电 +4.0 kW",
    simTime: overrides.simTime ?? "2026-09-26T08:14:00.000Z",
    createdAt: overrides.createdAt ?? "2026-09-27T02:14:00.000Z"
  };
}

beforeEach(() => {
  vi.mocked(getBaseEvents).mockReset();
});

afterEach(cleanup);

describe("EventsPanel", () => {
  it("展示事件列表：类型标签、标题、明细与基地时间（契约 1）", async () => {
    vi.mocked(getBaseEvents).mockResolvedValue({
      events: [
        event({ id: "e-2", type: "extraction.delivered", title: "采矿送达", detail: "铜矿 4 已入仓", simTime: "2026-09-26T09:02:00.000Z" }),
        event({ id: "e-1", type: "project.completed", title: "安装首座太阳能已完工" })
      ]
    });
    render(<EventsPanel csrfToken="csrf-1" refreshKey={7} />);
    const panel = await screen.findByText(/事件记录（2）/);
    expect(panel).toBeTruthy();
    expect(getBaseEvents).toHaveBeenCalledWith("csrf-1", 100);
    expect(screen.getByText("工程完工")).toBeTruthy();
    expect(screen.getByText("安装首座太阳能已完工")).toBeTruthy();
    expect(screen.getByText("发电 +4.0 kW")).toBeTruthy();
    expect(screen.getByText("09-26 09:02")).toBeTruthy(); // simTime 基地时间
  });

  it("端点 404/失败时整个面板隐藏，不显示错误（旧服务端兼容）", async () => {
    vi.mocked(getBaseEvents).mockRejectedValue(new BaseApiError(404, "NOT_FOUND", "not found"));
    render(<EventsPanel csrfToken="csrf-1" />);
    await waitFor(() => expect(getBaseEvents).toHaveBeenCalledOnce());
    expect(screen.queryByText(/事件记录/)).toBeNull();
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("无会话（csrfToken 缺失）时不发请求、不渲染", () => {
    render(<EventsPanel csrfToken={null} />);
    expect(getBaseEvents).not.toHaveBeenCalled();
    expect(screen.queryByText(/事件记录/)).toBeNull();
  });

  it("快照 refreshKey 变化时重新拉取事件", async () => {
    vi.mocked(getBaseEvents).mockResolvedValue({ events: [event()] });
    const { rerender } = render(<EventsPanel csrfToken="csrf-1" refreshKey={7} />);
    await waitFor(() => expect(getBaseEvents).toHaveBeenCalledTimes(1));
    rerender(<EventsPanel csrfToken="csrf-1" refreshKey={8} />);
    await waitFor(() => expect(getBaseEvents).toHaveBeenCalledTimes(2));
  });
});
