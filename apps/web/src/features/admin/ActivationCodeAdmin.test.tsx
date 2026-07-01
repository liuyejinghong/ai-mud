import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { ActivationCodeAdmin } from "./ActivationCodeAdmin";

describe("ActivationCodeAdmin", () => {
  it("renders activation-code creation controls", () => {
    render(<ActivationCodeAdmin />);

    expect(screen.getByRole("heading", { name: "激活码管理" })).toBeTruthy();
    expect(screen.getByLabelText("备注")).toBeTruthy();
    expect(screen.getByRole("button", { name: "生成一次性激活码" })).toBeTruthy();
  });
});
