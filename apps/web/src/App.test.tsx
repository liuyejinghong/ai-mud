import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { App } from "./App";

describe("App", () => {
  it("does not expose activation-code administration to unauthenticated visitors", () => {
    render(<App />);

    expect(screen.getByRole("heading", { name: "AI MUD 内测登录" })).toBeTruthy();
    expect(screen.queryByRole("heading", { name: "激活码管理" })).toBeNull();
  });
});
