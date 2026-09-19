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

  it("shows activation code only in registration mode", () => {
    render(<AuthPage />);

    fireEvent.click(screen.getByRole("button", { name: "前往登录" }));
    fireEvent.click(screen.getByRole("tab", { name: "激活码注册" }));

    expect(screen.getByLabelText("激活码")).toBeTruthy();
    expect(screen.getByLabelText("确认密码")).toBeTruthy();
    expect(screen.getByRole("button", { name: "创建账号" })).toBeTruthy();
  });

  it("rejects short registration passwords before calling the server", () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    render(<AuthPage />);

    fireEvent.click(screen.getByRole("button", { name: "前往登录" }));
    fireEvent.click(screen.getByRole("tab", { name: "激活码注册" }));
    fireEvent.change(screen.getByLabelText("邮箱"), { target: { value: "player@example.com" } });
    fireEvent.change(screen.getByLabelText("密码"), { target: { value: "123456789" } });
    fireEvent.change(screen.getByLabelText("确认密码"), { target: { value: "123456789" } });
    fireEvent.change(screen.getByLabelText("激活码"), {
      target: { value: "MUD–7K3M–9Q2P–6R8T" }
    });

    fireEvent.click(screen.getByRole("button", { name: "创建账号" }));

    expect(screen.getByRole("status").textContent).toBe("密码至少需要 12 个字符。");
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("normalizes pasted activation-code dashes before registration", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          error: { code: "ACTIVATION_CODE_INVALID", message: "Activation code cannot be used" }
        }),
        { status: 400, headers: { "Content-Type": "application/json" } }
      )
    );
    render(<AuthPage />);

    fireEvent.click(screen.getByRole("button", { name: "前往登录" }));
    fireEvent.click(screen.getByRole("tab", { name: "激活码注册" }));
    fireEvent.change(screen.getByLabelText("邮箱"), { target: { value: " player@example.com " } });
    fireEvent.change(screen.getByLabelText("密码"), { target: { value: "LongPassword123" } });
    fireEvent.change(screen.getByLabelText("确认密码"), { target: { value: "LongPassword123" } });
    fireEvent.change(screen.getByLabelText("激活码"), {
      target: { value: " MUD–7K3M–9Q2P–6R8T " }
    });

    fireEvent.click(screen.getByRole("button", { name: "创建账号" }));

    await waitFor(() => expect(fetchSpy).toHaveBeenCalledTimes(1));
    const [, init] = fetchSpy.mock.calls[0]!;
    expect(JSON.parse(String(init?.body))).toMatchObject({
      email: "player@example.com",
      activationCode: "MUD-7K3M-9Q2P-6R8T"
    });
    expect(screen.getByRole("status").textContent).toBe("激活码无效，请检查字符和横线。");
  });
});
