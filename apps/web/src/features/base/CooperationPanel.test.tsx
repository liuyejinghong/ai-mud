import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import type { CooperationRequestDto } from "@ai-mud/shared";
import { CooperationPanel } from "./CooperationPanel.js";

function makeRequest(overrides: Partial<CooperationRequestDto> = {}): CooperationRequestDto {
  return {
    requestId: "request-1",
    projectId: "project-1",
    projectName: "安装太阳电池阵",
    stepIndex: 1,
    fromGroupId: "engineering",
    helperGroupId: "transport",
    status: "pending",
    helperOperatorId: null,
    question: "资源运输组能派一台车把电缆运到建设位 A 吗？",
    createdAt: "2026-09-19T08:00:00.000Z",
    ...overrides
  };
}

afterEach(() => {
  cleanup();
});

describe("CooperationPanel", () => {
  it("没有协作请求时不渲染任何内容", () => {
    const { container } = render(<CooperationPanel requests={[]} />);

    expect(container.textContent).toBe("");
  });

  it("pending 请求显示项目名、步骤号、中文状态与问题", () => {
    render(<CooperationPanel requests={[makeRequest()]} />);

    expect(screen.getByText("安装太阳电池阵 · 第 2 步")).toBeTruthy();
    expect(screen.getByText("等待支援")).toBeTruthy();
    expect(screen.getByText("资源运输组能派一台车把电缆运到建设位 A 吗？")).toBeTruthy();
  });

  it("accepted 请求显示支援已接受与 helper 小组和操作员信息", () => {
    render(
      <CooperationPanel
        requests={[makeRequest({ status: "accepted", helperOperatorId: "rover-2" })]}
      />
    );

    expect(screen.getByText("支援已接受")).toBeTruthy();
    expect(screen.getByText("已由资源运输组的 rover-2 接手支援")).toBeTruthy();
  });

  it("accepted 且未指派操作员时仍显示支援小组", () => {
    render(<CooperationPanel requests={[makeRequest({ status: "accepted" })]} />);

    expect(screen.getByText("已由资源运输组接手支援")).toBeTruthy();
  });

  it("declined、expired、fulfilled 分别显示对应中文状态", () => {
    render(
      <CooperationPanel
        requests={[
          makeRequest({ requestId: "r-declined", status: "declined" }),
          makeRequest({ requestId: "r-expired", status: "expired" }),
          makeRequest({ requestId: "r-fulfilled", status: "fulfilled" })
        ]}
      />
    );

    expect(screen.getByText("已婉拒")).toBeTruthy();
    expect(screen.getByText("已超时")).toBeTruthy();
    expect(screen.getByText("已完成")).toBeTruthy();
  });

  it("多条请求按列表全部展示", () => {
    const requests = [
      makeRequest({ requestId: "r-1", projectName: "安装太阳电池阵" }),
      makeRequest({ requestId: "r-2", projectName: "架设储电站", stepIndex: 0 }),
      makeRequest({
        requestId: "r-3",
        projectName: "检修风塔",
        stepIndex: 2,
        status: "fulfilled"
      })
    ];
    const { container } = render(<CooperationPanel requests={requests} />);

    const items = container.querySelectorAll("li.base-cooperation-item");
    expect(items).toHaveLength(3);
    expect(screen.getByText("架设储电站 · 第 1 步")).toBeTruthy();
    expect(screen.getByText("检修风塔 · 第 3 步")).toBeTruthy();
  });

  it("面板是纯展示：不渲染任何按钮或可交互控件", () => {
    const { container } = render(<CooperationPanel requests={[makeRequest()]} />);

    expect(container.querySelectorAll("button, input, select")).toHaveLength(0);
  });
});
