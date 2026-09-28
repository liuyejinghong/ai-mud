import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { BaseResetControl } from "./BaseResetControl.js";

// 重开基地两步确认的回归：确认前绝不触发 onReset；两步各自可取消；
// 确认后调用一次并显示进行中；失败保留对话框、重试复用同一 commandId（服务端收据幂等）。

afterEach(cleanup);

describe("BaseResetControl", () => {
  it("初始只显示入口按钮，不出现对话框，也不触发 onReset", () => {
    const onReset = vi.fn(async () => undefined);
    render(<BaseResetControl onReset={onReset} />);

    expect(screen.getByRole("button", { name: "重开基地" })).toBeTruthy();
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(onReset).not.toHaveBeenCalled();
  });

  it("第一步列后果；不点「继续」就不会删除；「先不重开」可退出", async () => {
    const onReset = vi.fn(async () => undefined);
    render(<BaseResetControl onReset={onReset} />);

    fireEvent.click(screen.getByRole("button", { name: "重开基地" }));

    const dialog = screen.getByRole("dialog", { name: "重开基地" });
    expect(dialog.textContent).toContain("永久删除，无法恢复");
    expect(dialog.textContent).toContain("账号和登录状态保留");
    expect(dialog.textContent).toContain("从落地第一天重新开始");
    // 第一步只有「继续」，没有最终确认按钮。
    expect(screen.queryByRole("button", { name: "确认重开" })).toBeNull();
    expect(onReset).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "先不重开" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(onReset).not.toHaveBeenCalled();
  });

  it("第二步才出现「确认重开」；点击后调用一次 onReset，成功后关闭", async () => {
    const onReset = vi.fn<(commandId: string) => Promise<void>>(async () => undefined);
    render(<BaseResetControl onReset={onReset} />);

    fireEvent.click(screen.getByRole("button", { name: "重开基地" }));
    fireEvent.click(screen.getByRole("button", { name: "继续" }));
    expect(screen.getByRole("dialog").textContent).toContain("无法撤销");
    expect(onReset).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "确认重开" }));

    expect(onReset).toHaveBeenCalledTimes(1);
    expect(onReset.mock.calls[0]?.[0]).toMatch(/^[0-9a-f-]{36}$/);
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });

  it("进行中：确认按钮变为「正在重开…」且禁用，不产生第二次调用", async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const onReset = vi.fn<(commandId: string) => Promise<void>>(async () => {
      await gate;
    });
    render(<BaseResetControl onReset={onReset} />);

    fireEvent.click(screen.getByRole("button", { name: "重开基地" }));
    fireEvent.click(screen.getByRole("button", { name: "继续" }));
    const confirm = screen.getByRole("button", { name: "确认重开" });
    fireEvent.click(confirm);

    expect(screen.getByRole("button", { name: "正在重开…" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "正在重开…" }));
    expect(onReset).toHaveBeenCalledTimes(1);
    release();
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });

  it("失败：错误可见、对话框保留；重试复用同一 commandId", async () => {
    const onReset = vi
      .fn<(commandId: string) => Promise<void>>()
      .mockImplementationOnce(async () => {
        throw new Error("服务器暂时没有响应");
      })
      .mockResolvedValueOnce(undefined);
    render(<BaseResetControl onReset={onReset} />);

    fireEvent.click(screen.getByRole("button", { name: "重开基地" }));
    fireEvent.click(screen.getByRole("button", { name: "继续" }));
    fireEvent.click(screen.getByRole("button", { name: "确认重开" }));

    expect(await screen.findByRole("alert")).toBeTruthy();
    expect(screen.getByRole("dialog")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "确认重开" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());

    expect(onReset).toHaveBeenCalledTimes(2);
    expect(onReset.mock.calls[0]?.[0]).toBe(onReset.mock.calls[1]?.[0]);
  });

  it("第二步「返回」可退出且不触发删除；Esc 亦可关闭", async () => {
    const onReset = vi.fn(async () => undefined);
    render(<BaseResetControl onReset={onReset} />);

    fireEvent.click(screen.getByRole("button", { name: "重开基地" }));
    fireEvent.click(screen.getByRole("button", { name: "继续" }));
    fireEvent.click(screen.getByRole("button", { name: "返回" }));

    expect(screen.queryByRole("dialog")).toBeNull();
    expect(onReset).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "重开基地" }));
    fireEvent.keyDown(screen.getByRole("dialog", { name: "重开基地" }), { key: "Escape" });
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(onReset).not.toHaveBeenCalled();
  });

  it("disabled 时入口按钮禁用", () => {
    render(<BaseResetControl onReset={() => Promise.resolve(undefined)} disabled />);
    expect((screen.getByRole("button", { name: "重开基地" }) as HTMLButtonElement).disabled).toBe(true);
  });
});
