import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { AuthPage } from "./AuthPage";

afterEach(() => {
  cleanup();
});

describe("AuthPage", () => {
  it("renders login first without registration-only fields", () => {
    render(<AuthPage />);

    expect(screen.getByRole("heading", { name: "AI MUD 内测登录" })).toBeTruthy();
    expect(screen.getByLabelText("邮箱")).toBeTruthy();
    expect(screen.getByLabelText("密码")).toBeTruthy();
    expect(screen.queryByLabelText("激活码")).toBeNull();
    expect(screen.queryByLabelText("确认密码")).toBeNull();
    expect(screen.getByRole("button", { name: "登录" })).toBeTruthy();
  });

  it("shows activation code only in registration mode", () => {
    render(<AuthPage />);

    fireEvent.click(screen.getByRole("tab", { name: "注册" }));

    expect(screen.getByLabelText("激活码")).toBeTruthy();
    expect(screen.getByLabelText("确认密码")).toBeTruthy();
    expect(screen.getByRole("button", { name: "创建账号" })).toBeTruthy();
  });
});
