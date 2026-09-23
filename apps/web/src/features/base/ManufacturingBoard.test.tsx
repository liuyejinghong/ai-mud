import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ManufacturingJobDto, RecipeTemplateDto } from "@ai-mud/shared";
import { ManufacturingBoard, type ManufacturingBoardProps } from "./ManufacturingBoard.js";

const recipeH1: RecipeTemplateDto = {
  ref: { kind: "recipe", stableId: "manufacture-yd-h1", revision: 1 },
  name: "制造 YD-H1 机器人",
  description: "用支撑架与备用零件组装一台 YD-H1 巡逻机器人。",
  inputs: [
    { itemId: "support_frame", quantity: 4 },
    { itemId: "spare_parts", quantity: 6 },
    { itemId: "power_box", quantity: 1 }
  ],
  workPerUnit: 30,
  output: { templateStableId: "yd_h1", initialBatteryWh: 12000 }
};

const recipeS1: RecipeTemplateDto = {
  ref: { kind: "recipe", stableId: "manufacture-yd-s1", revision: 1 },
  name: "制造 YD-S1 机器人",
  description: "组装一台轻量 YD-S1 侦察机器人。",
  inputs: [
    { itemId: "spare_parts", quantity: 4 },
    { itemId: "anchor", quantity: 3 }
  ],
  workPerUnit: 20,
  output: { templateStableId: "yd_s1", initialBatteryWh: 6000 }
};

// 在途工单持开工时修订（G06）：job-2 的 revision 高于当前模板列表，仍按 stableId 关联工作量。
const jobActive: ManufacturingJobDto = {
  jobId: "job-1",
  recipeRef: { kind: "recipe", stableId: "manufacture-yd-h1", revision: 1 },
  recipeName: "制造 YD-H1 机器人",
  status: "active",
  outputsPlanned: 3,
  outputsDone: 1,
  currentUnitWorkDone: 12,
  blockedReason: null
};

const jobBlocked: ManufacturingJobDto = {
  jobId: "job-2",
  recipeRef: { kind: "recipe", stableId: "manufacture-yd-s1", revision: 2 },
  recipeName: "制造 YD-S1 机器人",
  status: "blocked",
  outputsPlanned: 2,
  outputsDone: 0,
  currentUnitWorkDone: 5,
  blockedReason: "insufficient_power"
};

function renderBoard(overrides: Partial<ManufacturingBoardProps> = {}) {
  const props = {
    jobs: [] as ManufacturingJobDto[],
    recipes: [] as RecipeTemplateDto[],
    isBusy: false,
    onCreateJob: vi.fn(),
    onCancelJob: vi.fn(),
    selectedJobId: null,
    onSelectJob: vi.fn(),
    ...overrides
  };
  render(<ManufacturingBoard {...props} />);
  return props;
}

beforeEach(() => {
  vi.clearAllMocks();
  // 固定 commandId，断言开工调用参数里的 uuid。
  vi.stubGlobal("crypto", { randomUUID: () => "command-uuid-1" });
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("ManufacturingBoard", () => {
  it("渲染可用配方名称、描述与材料清单（材料名走中文映射，评审 D004）", () => {
    renderBoard({ recipes: [recipeH1, recipeS1] });

    expect(screen.getByText("制造 YD-H1 机器人")).toBeTruthy();
    expect(screen.getByText("用支撑架与备用零件组装一台 YD-H1 巡逻机器人。")).toBeTruthy();
    expect(screen.getByText("材料：支架结构件×4、通用备件×6、配电单元×1")).toBeTruthy();
    expect(screen.getByText("材料：通用备件×4、锚固件×3")).toBeTruthy();
    expect(screen.getByText("每台工作量 30")).toBeTruthy();
    expect(screen.getByRole("spinbutton", { name: "制造 YD-H1 机器人数量" })).toBeTruthy();
  });

  it("开工按钮按输入数量与随机 commandId 上报开工", () => {
    const onCreateJob = vi.fn();
    renderBoard({ recipes: [recipeH1], onCreateJob });

    fireEvent.change(screen.getByRole("spinbutton", { name: "制造 YD-H1 机器人数量" }), {
      target: { value: "3" }
    });
    fireEvent.click(screen.getByRole("button", { name: "开工 制造 YD-H1 机器人" }));

    expect(onCreateJob).toHaveBeenCalledOnce();
    expect(onCreateJob).toHaveBeenCalledWith({
      recipeRef: { kind: "recipe", stableId: "manufacture-yd-h1", revision: 1 },
      outputsPlanned: 3,
      commandId: "command-uuid-1"
    });
  });

  it("渲染工单状态、产出进度与当前台工作量进度", () => {
    renderBoard({ jobs: [jobActive, jobBlocked], recipes: [recipeH1, recipeS1] });

    expect(screen.getByText("进行中", { selector: ".base-project-status" })).toBeTruthy();
    expect(screen.getByText("已阻塞", { selector: ".base-project-status" })).toBeTruthy();
    expect(screen.getByText("产出 1/3 台")).toBeTruthy();

    const unitProgress = screen.getByRole("progressbar", {
      name: "制造 YD-H1 机器人当前台进度"
    });
    expect(unitProgress.getAttribute("aria-valuenow")).toBe("12");
    expect(unitProgress.getAttribute("aria-valuemax")).toBe("30");
    expect(unitProgress.getAttribute("aria-valuetext")).toBe("40%");
    expect(screen.getByText("12/30", { selector: ".base-progress-text" })).toBeTruthy();

    // 旧修订在途工单按 stableId 关联当前模板的 workPerUnit。
    const blockedProgress = screen.getByRole("progressbar", {
      name: "制造 YD-S1 机器人当前台进度"
    });
    expect(blockedProgress.getAttribute("aria-valuemax")).toBe("20");
  });

  it("阻塞工单显示映射后的阻塞原因", () => {
    renderBoard({ jobs: [jobBlocked], recipes: [recipeS1] });

    expect(screen.getByText("已阻塞：供电不足")).toBeTruthy();
  });

  it("取消工单先弹确认（含材料退还说明），确认后才上报取消", () => {
    const onCancelJob = vi.fn();
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(false);
    renderBoard({ jobs: [jobActive], recipes: [recipeH1], onCancelJob });

    fireEvent.click(screen.getByRole("button", { name: "取消工单 制造 YD-H1 机器人" }));
    expect(confirmSpy).toHaveBeenCalledOnce();
    expect(confirmSpy.mock.calls[0]?.[0]).toContain("未消耗");
    expect(confirmSpy.mock.calls[0]?.[0]).toContain("退还");
    expect(onCancelJob).not.toHaveBeenCalled();

    confirmSpy.mockReturnValue(true);
    fireEvent.click(screen.getByRole("button", { name: "取消工单 制造 YD-H1 机器人" }));
    expect(onCancelJob).toHaveBeenCalledOnce();
    expect(onCancelJob).toHaveBeenCalledWith("job-1");
  });

  it("点击工单卡片上报选择并反映 aria-pressed 选中态", () => {
    const onSelectJob = vi.fn();
    renderBoard({
      jobs: [jobActive, jobBlocked],
      recipes: [recipeH1, recipeS1],
      selectedJobId: "job-1",
      onSelectJob
    });

    const activeCard = screen.getByRole("button", { name: /^制造 YD-H1 机器人/ });
    const blockedCard = screen.getByRole("button", { name: /^制造 YD-S1 机器人/ });
    expect(activeCard.getAttribute("aria-pressed")).toBe("true");
    expect(blockedCard.getAttribute("aria-pressed")).toBe("false");

    fireEvent.click(blockedCard);
    expect(onSelectJob).toHaveBeenCalledOnce();
    expect(onSelectJob).toHaveBeenCalledWith("job-2");
  });

  it("没有工单时显示引导空态文案", () => {
    renderBoard({ recipes: [recipeH1] });

    expect(screen.getByText("还没有制造工单。选一个配方开工。")).toBeTruthy();
  });

  it("isBusy 时禁用开工与取消按钮和数量输入", () => {
    renderBoard({ jobs: [jobActive], recipes: [recipeH1], isBusy: true });

    expect(
      screen.getByRole("button", { name: "开工 制造 YD-H1 机器人" }).hasAttribute("disabled")
    ).toBe(true);
    expect(
      screen.getByRole("button", { name: "取消工单 制造 YD-H1 机器人" }).hasAttribute("disabled")
    ).toBe(true);
    expect(
      screen.getByRole("spinbutton", { name: "制造 YD-H1 机器人数量" }).hasAttribute("disabled")
    ).toBe(true);
  });
});
