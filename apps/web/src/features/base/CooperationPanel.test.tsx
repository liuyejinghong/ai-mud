import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { BaseDeviceDto, CooperationRequestDto } from "@ai-mud/shared";
import { CooperationPanel } from "./CooperationPanel.js";

const devices: BaseDeviceDto[] = [
  {
    deviceId: "device-2",
    operatorId: "operator-2",
    name: "驮运二号",
    groupId: "transport",
    description: "测试设备",
    status: "idle",
    batteryWh: 1000,
    batteryCapacityWh: 2000,
    currentAssignment: null
  }
];

function makeRequest(overrides: Partial<CooperationRequestDto> = {}): CooperationRequestDto {
  return {
    requestId: "request-1",
    projectId: "project-1",
    projectName: "安装太阳电池阵",
    stepIndex: 1,
    fromGroupId: "engineering",
    helperGroupId: "transport",
    status: "pending",
    resolutionReason: null,
    helperOperatorId: null,
    playerDecisionAllowed: true,
    proposedHelper: null,
    question: "资源运输组能派一台车把电缆运到建设位 A 吗？",
    createdAt: "2026-09-19T08:00:00.000Z",
    ...overrides
  };
}

afterEach(cleanup);

describe("CooperationPanel", () => {
  it("没有协作请求时显示工作区空态", () => {
    const { container } = render(<CooperationPanel requests={[]} devices={devices} />);

    expect(screen.getByText("目前没有协作请求。")).toBeTruthy();
    expect(container.querySelector("section.base-cooperation")).toBeTruthy();
    expect(container.querySelector(".base-cooperation-history")).toBeNull();
  });

  it("待支援请求显示项目、步骤和阻塞说明", () => {
    render(<CooperationPanel requests={[makeRequest()]} devices={devices} />);

    expect(screen.getByText("安装太阳电池阵 · 第 2 步")).toBeTruthy();
    expect(screen.getByText("等待支援")).toBeTruthy();
    expect(screen.getByText("资源运输组能派一台车把电缆运到建设位 A 吗？")).toBeTruthy();
    expect(screen.queryByText(/协作历史/)).toBeNull();
  });

  it("已接受请求用设备名叙述，原始身份留在来源详情", () => {
    const { container } = render(
      <CooperationPanel
        requests={[makeRequest({ status: "accepted", helperOperatorId: "operator-2" })]}
        devices={devices}
      />
    );

    expect(screen.getByText("支援已接受")).toBeTruthy();
    expect(screen.getByText("已由资源运输组的驮运二号接手支援")).toBeTruthy();
    expect(container.querySelector(".base-cooperation-helper")?.textContent).not.toContain("operator-2");
    expect(container.querySelector("details")?.open).toBe(false);
    fireEvent.click(screen.getByText("查看请求来源"));
    expect(container.querySelector("details")?.open).toBe(true);
    expect(screen.getByText("operator-2")).toBeTruthy();
    expect(screen.getByText("request-1")).toBeTruthy();
  });

  it("操作员不在设备快照中时只显示支援小组", () => {
    render(
      <CooperationPanel
        requests={[makeRequest({ status: "accepted", helperOperatorId: "missing-operator" })]}
        devices={devices}
      />
    );

    expect(screen.getByText("已由资源运输组接手支援")).toBeTruthy();
  });

  it("结束请求默认折叠，异常数量仍可见", () => {
    const requests = [
      makeRequest({ requestId: "r-declined", status: "declined" }),
      makeRequest({ requestId: "r-expired", status: "expired" }),
      makeRequest({ requestId: "r-fulfilled", status: "fulfilled" })
    ];
    const { container } = render(<CooperationPanel requests={requests} devices={devices} />);
    const history = container.querySelector<HTMLDetailsElement>("details.base-cooperation-history");

    expect(history?.open).toBe(false);
    expect(history?.querySelector("summary")?.textContent).toContain("协作历史 3 条 · 已婉拒 1 条 · 已超时 1 条");
    expect(history?.querySelectorAll("li.base-cooperation-item")).toHaveLength(3);
    expect(screen.getByText("目前没有进行中的支援请求。")).toBeTruthy();
  });

  it("项目取消的协作历史显示真实结案原因，不误报为超时", () => {
    render(<CooperationPanel requests={[makeRequest({ status: "expired", resolutionReason: "project_cancelled" })]} devices={devices} />);

    expect(screen.getByText("工程已取消")).toBeTruthy();
    expect(screen.getByText(/协作历史 1 条 · 已结案 1 条/)).toBeTruthy();
    expect(screen.queryByText(/已超时 1 条/)).toBeNull();
  });

  it("53 条同文案历史保留不同请求身份，两个活动工程不被折叠", () => {
    const historyRequests = Array.from({ length: 53 }, (_, index) =>
      makeRequest({
        requestId: `history-${index}`,
        projectId: index < 27 ? "project-1" : "project-2",
        projectName: index < 27 ? "安装太阳电池阵" : "架设储电站",
        status: index === 0 ? "expired" : "fulfilled"
      })
    );
    const requests = [
      makeRequest({ requestId: "active-1", projectName: "安装太阳电池阵" }),
      makeRequest({ requestId: "active-2", projectId: "project-2", projectName: "架设储电站" }),
      ...historyRequests
    ];
    const { container } = render(<CooperationPanel requests={requests} devices={devices} />);
    const history = container.querySelector<HTMLDetailsElement>("details.base-cooperation-history");

    expect(container.querySelectorAll("section.base-cooperation > ul > li")).toHaveLength(2);
    expect(history?.open).toBe(false);
    expect(history?.querySelector("summary")?.textContent).toContain("协作历史 53 条 · 已超时 1 条");
    expect(history?.querySelectorAll("li")).toHaveLength(53);
    const ids = [...(history?.querySelectorAll("li details code:first-of-type") ?? [])].map((node) => node.textContent);
    expect(new Set(ids).size).toBe(53);
    expect(ids).toContain("history-0");
    expect(ids).toContain("history-52");
    expect(screen.getAllByText("资源运输组能派一台车把电缆运到建设位 A 吗？")).toHaveLength(55);
  });

  it("待决请求展示具名候选，并把支援或等待交给命令处理者", () => {
    const onDecision = vi.fn();
    const pending = makeRequest({ proposedHelper: {
      operatorId: "operator-2", groupId: "transport", batteryWh: 1000, batteryCapacityWh: 2000
    } });
    render(<CooperationPanel requests={[pending]} devices={devices} onDecision={onDecision} />);

    expect(screen.getByText(/驮运二号.*1000\/2000 Wh/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "批准跨组支援" }));
    expect(onDecision).toHaveBeenCalledWith("request-1", "support", "operator-2");
    fireEvent.click(screen.getByRole("button", { name: "等待本组充电" }));
    expect(onDecision).toHaveBeenCalledWith("request-1", "wait");
  });

  it("候选失效时仍允许等待，不虚构替代机器人", () => {
    render(<CooperationPanel requests={[makeRequest({ proposedHelper: null })]} devices={devices} onDecision={vi.fn()} />);
    expect((screen.getByRole("button", { name: "批准跨组支援" }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole("button", { name: "等待本组充电" }) as HTMLButtonElement).disabled).toBe(false);
  });

  it("后续 pending 只显示状态，不提供会被服务端拒绝的玩家按钮", () => {
    render(<CooperationPanel requests={[makeRequest({ playerDecisionAllowed: false })]} devices={devices} onDecision={vi.fn()} />);
    expect(screen.getByText("等待支援")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "等待本组充电" })).toBeNull();
  });
});
