import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { AuthPage } from "./AuthPage";

describe("AuthPage", () => {
  it("renders login and registration controls including activation code", () => {
    render(<AuthPage />);

    expect(screen.getByRole("heading", { name: "AI MUD 内测登录" })).toBeTruthy();
    expect(screen.getByLabelText("邮箱")).toBeTruthy();
    expect(screen.getByLabelText("密码")).toBeTruthy();
    expect(screen.getByLabelText("激活码")).toBeTruthy();
    expect(screen.getByRole("button", { name: "注册并进入" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "登录" })).toBeTruthy();
  });
});
