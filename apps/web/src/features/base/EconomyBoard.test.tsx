import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { EconomyBoard } from "./EconomyBoard.js";

afterEach(cleanup);

const order = {
  orderId: "order-1",
  orderRef: { kind: "order" as const, stableId: "order-a", revision: 1 },
  name: "首批安装订单",
  status: "open" as const,
  requiredItemId: "solar_panel_set",
  requiredItemName: "太阳电池阵组件",
  quantity: 6,
  rewardCredits: 300,
  deadlineSim: "2126-01-05T18:00:00.000Z",
  acceptedAtSim: null
};

const purchase = {
  purchaseId: "purchase-1",
  itemId: "support_frame",
  itemName: "支架结构件",
  quantity: 3,
  costCredits: 120,
  status: "in_transit" as const,
  arrivesAtSim: "2126-01-06T08:00:00.000Z"
};

function renderBoard(overrides: Partial<Parameters<typeof EconomyBoard>[0]> = {}) {
  return render(
    <EconomyBoard
      credits={500}
      orders={[order]}
      purchases={[purchase]}
      resources={[]}
      isBusy={false}
      selectedOrderId={null}
      onSelectOrder={vi.fn()}
      onAcceptOrder={vi.fn()}
      onDeliverOrder={vi.fn()}
      onPurchase={vi.fn()}
      {...overrides}
    />
  );
}

describe("EconomyBoard", () => {
  it("订单卡显示交付期限，在途采购显示预计到货时间（ECON-01）", () => {
    renderBoard();
    expect(screen.getByText(/期限 01-05 18:00/)).toBeTruthy();
    expect(screen.getByText(/预计到货 01-06 08:00/)).toBeTruthy();
  });

  it("采购可输入数量后按数量下单，不再只能逐件（ECON-02）", () => {
    const onPurchase = vi.fn();
    renderBoard({ onPurchase });

    const input = screen.getByLabelText("购买数量·支架结构件") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "6" } });
    const row = input.closest("li") as HTMLElement;
    fireEvent.click(within(row).getByRole("button", { name: "购入" }));

    expect(onPurchase).toHaveBeenCalledWith("support_frame", 6);
  });

  it("采购数量非法输入回落为 1，不会下单 0 或负数", () => {
    const onPurchase = vi.fn();
    renderBoard({ onPurchase });

    const input = screen.getByLabelText("购买数量·支架结构件") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "0" } });
    const row = input.closest("li") as HTMLElement;
    fireEvent.click(within(row).getByRole("button", { name: "购入" }));

    expect(onPurchase).toHaveBeenCalledWith("support_frame", 1);
  });
});
