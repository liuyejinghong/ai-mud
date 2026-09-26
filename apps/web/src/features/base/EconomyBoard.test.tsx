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
      simTime="2126-01-01T08:00:00.000Z"
      isBusy={false}
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

  it("已接订单按可支配量提示缺口，交付仍由服务端复核", () => {
    const onDeliverOrder = vi.fn();
    renderBoard({
      orders: [{ ...order, status: "accepted" }],
      resources: [{
        itemId: "solar_panel_set", name: "太阳电池阵组件", quantity: 8,
        reservedQuantity: 8,
        reservationSources: [{ kind: "project", id: "p1", name: "安装太阳能阵列", quantity: 8 }],
        description: ""
      }],
      onDeliverOrder
    });
    expect(screen.getByText(/可支配 0 · 总量 8 · 已占用 8 · 尚缺 6 · 占用去向：工程「安装太阳能阵列」×8/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "交付物资" }));
    expect(onDeliverOrder).toHaveBeenCalledWith("order-1");
  });

  it("第二阵列就地列出五类材料净缺口、在途抵扣、总价和付款前到货时间", () => {
    renderBoard({
      orders: [],
      targetProject: {
        definitionRef: { kind: "project", stableId: "install-second-array", revision: 1 },
        name: "架设第二太阳电池阵", description: "扩建",
        inputs: [
          { itemId: "solar_panel_set", quantity: 6 },
          { itemId: "support_frame", quantity: 8 },
          { itemId: "cable", quantity: 4 },
          { itemId: "power_box", quantity: 2 },
          { itemId: "anchor", quantity: 10 }
        ]
      },
      resources: [
        { itemId: "solar_panel_set", name: "太阳电池阵组件", quantity: 2, reservedQuantity: 0, reservationSources: [], description: "" },
        { itemId: "support_frame", name: "支架结构件", quantity: 1, reservedQuantity: 1, reservationSources: [], description: "" },
        { itemId: "power_box", name: "配电单元", quantity: 1, reservedQuantity: 0, reservationSources: [], description: "" },
        { itemId: "anchor", name: "锚固件", quantity: 8, reservedQuantity: 8, reservationSources: [], description: "" }
      ],
      purchases: [purchase, { ...purchase, purchaseId: "purchase-2", itemId: "anchor", itemName: "锚固件" }]
    });

    const budget = screen.getByLabelText("架设第二太阳电池阵材料预算");
    expect(within(budget).getAllByRole("listitem")).toHaveLength(5);
    expect(within(budget).getByText(/支架结构件：需 8，可支配 0，现缺 8，在途 3（未入库），净缺口 5.*小计 200 credits/)).toBeTruthy();
    expect(within(budget).getByText(/锚固件：需 10，可支配 0，现缺 10，在途 3（未入库），净缺口 7.*小计 105 credits/)).toBeTruthy();
    expect(within(budget).getByText(/还需采购 21 件 · 合计 945 credits · 当前账款还差 445 credits/)).toBeTruthy();
    expect(within(budget).getByText(/预计 20 基地分钟到货.*01-01 08:20.*到货前不可用于开工/)).toBeTruthy();
  });
});
