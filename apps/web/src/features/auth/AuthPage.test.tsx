import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AuthPage } from "./AuthPage";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("AuthPage", () => {
  it("opens on the playtest tab without registration-only fields", () => {
    render(<AuthPage />);

    // v0.12：默认试玩注册为主行动（无 tab），激活码注册收进登录入口。
    expect(screen.queryByRole("tablist")).toBeNull();
    expect(screen.getByRole("button", { name: "前往登录" })).toBeTruthy();
    expect(screen.getByText(/首批无人货运飞船/)).toBeTruthy();
    expect(screen.getByLabelText("邮箱")).toBeTruthy();
    expect(screen.getByLabelText("密码")).toBeTruthy();
    expect(screen.queryByLabelText("激活码")).toBeNull();
    expect(screen.queryByLabelText("确认密码")).toBeNull();
    expect(screen.queryByRole("button", { name: "登录" })).toBeNull();
  });

  it("login view has no activation-code fields and offers return to playtest", () => {
    render(<AuthPage />);

    fireEvent.click(screen.getByRole("button", { name: "前往登录" }));

    expect(screen.getByRole("button", { name: "登录" })).toBeTruthy();
    expect(screen.queryByLabelText("激活码")).toBeNull();
    expect(screen.queryByLabelText("确认密码")).toBeNull();
    expect(screen.getByRole("button", { name: "返回试玩注册" })).toBeTruthy();
  });

  it("login rejects wrong credentials with the server message", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({ error: { code: "UNAUTHENTICATED", message: "Invalid" } }),
        { status: 401, headers: { "Content-Type": "application/json" } }
      )
    );
    render(<AuthPage />);

    fireEvent.click(screen.getByRole("button", { name: "前往登录" }));
    fireEvent.change(screen.getByLabelText("邮箱"), { target: { value: "p@e.test" } });
    fireEvent.change(screen.getByLabelText("密码"), { target: { value: "whatever1" } });
    fireEvent.click(screen.getByRole("button", { name: "登录" }));

    await waitFor(() => {
      expect(screen.getByRole("status").textContent).toContain("登录失败");
    });
    expect(fetchSpy).toHaveBeenCalled();
    fetchSpy.mockRestore();
  });

});
