import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { BaseIntroModal } from "./BaseIntroModal.js";

afterEach(cleanup);

describe("BaseIntroModal", () => {
  it("介绍背景、目标与三步指引，并说明暂停语义", () => {
    render(<BaseIntroModal baseName="先遣前哨" onDismiss={() => undefined} />);

    expect(screen.getByRole("dialog", { name: "新手引导" })).toBeTruthy();
    expect(screen.getByText(/首批无人货运飞船/)).toBeTruthy();
    expect(screen.getByText(/第一个任务/)).toBeTruthy();
    expect(screen.getByText(/恢复计时/)).toBeTruthy();
    expect(screen.getByText(/建设位 A/)).toBeTruthy();
    expect(screen.getByText(/自动暂停/)).toBeTruthy();
  });

  it("点击「开始指挥」上报关闭", () => {
    const onDismiss = vi.fn();
    render(<BaseIntroModal baseName="先遣前哨" onDismiss={onDismiss} />);

    fireEvent.click(screen.getByRole("button", { name: "开始指挥" }));

    expect(onDismiss).toHaveBeenCalledOnce();
  });

  it("标题带基地名称", () => {
    render(<BaseIntroModal baseName="余电前哨" onDismiss={() => undefined} />);

    expect(screen.getByText(/余电前哨/)).toBeTruthy();
  });
});
