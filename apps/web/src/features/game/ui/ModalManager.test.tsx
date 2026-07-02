import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ModalManager } from "./ModalManager";

describe("ModalManager", () => {
  afterEach(() => {
    cleanup();
  });

  it("renders one active modal through a single backdrop", () => {
    render(
      <ModalManager activeModal={{ type: "item", name: "野莓" }} onClose={vi.fn()}>
        {(modal) => (
          <section role="dialog" aria-modal="true" aria-label={modal.name}>
            {modal.name}
          </section>
        )}
      </ModalManager>
    );

    expect(screen.getAllByRole("dialog")).toHaveLength(1);
    expect(screen.getByRole("dialog", { name: "野莓" })).toBeTruthy();
  });

  it("closes from the backdrop but not from inside the dialog", () => {
    const onClose = vi.fn();
    render(
      <ModalManager activeModal={{ type: "item", name: "野莓" }} onClose={onClose}>
        {(modal) => (
          <section role="dialog" aria-modal="true" aria-label={modal.name}>
            {modal.name}
          </section>
        )}
      </ModalManager>
    );

    fireEvent.mouseDown(screen.getByRole("dialog", { name: "野莓" }));
    expect(onClose).not.toHaveBeenCalled();

    fireEvent.mouseDown(screen.getByTestId("modal-backdrop"));
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
