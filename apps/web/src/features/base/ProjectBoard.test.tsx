import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { BaseProjectDto } from "@ai-mud/shared";
import { ProjectBoard } from "./ProjectBoard.js";

const projects: BaseProjectDto[] = [
  {
    projectId: "project-1",
    definitionRef: { kind: "project", stableId: "install_solar_array", revision: 1 },
    name: "安装太阳能阵列",
    status: "active",
    siteId: "site-a",
    steps: [
      {
        index: 0,
        kind: "site_clearing",
        groupId: "engineering",
        status: "completed",
        workRequired: 40,
        workDone: 40,
        blockedReason: null
      },
      {
        index: 1,
        kind: "transport",
        groupId: "transport",
        status: "running",
        workRequired: 60,
        workDone: 15,
        blockedReason: null
      }
    ]
  },
  {
    projectId: "project-2",
    definitionRef: { kind: "project", stableId: "install_solar_array", revision: 1 },
    name: "第二座太阳能阵列",
    status: "blocked",
    siteId: "site-b",
    steps: [
      {
        index: 0,
        kind: "site_clearing",
        groupId: "engineering",
        status: "blocked",
        workRequired: 40,
        workDone: 0,
        blockedReason: "insufficient_power"
      }
    ]
  }
];
const liveProps = { devices: [], timeMode: "running" as const };

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(cleanup);

describe("ProjectBoard", () => {
  it("渲染项目名称、状态、当前步骤与工作量进度条", () => {
    render(<ProjectBoard {...liveProps} projects={projects} buildableProjects={[{ name: "安装运抵的太阳能设施", description: "把运抵的太阳电池阵安装到建设位并并网。" }]}
        selectedProjectId={null} onSelectProject={() => undefined} />);

    expect(screen.getByText("安装太阳能阵列")).toBeTruthy();
    expect(screen.getByText("进行中", { selector: ".base-project-status" })).toBeTruthy();
    expect(screen.getByText("当前步骤 2/2：物资运输（施工中）")).toBeTruthy();

    const progress = screen.getByRole("progressbar", { name: "安装太阳能阵列进度" });
    expect(progress.getAttribute("aria-valuenow")).toBe("15");
    expect(progress.getAttribute("aria-valuemax")).toBe("60");
    expect(progress.getAttribute("aria-valuetext")).toBe("25%");
  });

  it("受阻项目显示映射后的受阻原因", () => {
    render(<ProjectBoard {...liveProps} projects={projects} buildableProjects={[{ name: "安装运抵的太阳能设施", description: "把运抵的太阳电池阵安装到建设位并并网。" }]}
        selectedProjectId={null} onSelectProject={() => undefined} />);

    expect(screen.getByText("受阻")).toBeTruthy();
    expect(screen.getByText("受阻：供电不足")).toBeTruthy();
  });

  it("充电中的分配不算作业机组，零机组按低电、无工组和暂停解释", () => {
    const charging = {
      deviceId: "device-1", operatorId: "operator-1", name: "驮运一号", groupId: "transport" as const,
      status: "charging" as const, batteryWh: 200, batteryCapacityWh: 20000,
      currentAssignment: { projectId: "project-1", stepIndex: 1 }, description: ""
    };
    const props = { ...liveProps, projects: [projects[0]!], buildableProjects: [],
      selectedProjectId: null, onSelectProject: () => undefined };
    const view = render(<ProjectBoard {...props} devices={[charging]} />);
    expect(screen.getByText(/0 台作业中：本组设备电量低，需等待补电/)).toBeTruthy();
    expect(screen.queryByText(/机组 1 台作业中/)).toBeNull();

    view.rerender(<ProjectBoard {...props} devices={[]} />);
    expect(screen.getByText(/0 台作业中：没有资源运输组设备/)).toBeTruthy();

    view.rerender(<ProjectBoard {...props} devices={[charging]} timeMode="paused" />);
    expect(screen.getByText(/0 台作业中：基地时间已暂停/)).toBeTruthy();

    view.rerender(<ProjectBoard {...props} devices={[{ ...charging, status: "working", batteryWh: 1000 }]} />);
    expect(screen.getByText(/机组 1 台作业中/)).toBeTruthy();
    expect(screen.queryByText(/0 台作业中/)).toBeNull();
  });

  it("点击项目卡片时上报项目选择", () => {
    const onSelectProject = vi.fn();
    render(<ProjectBoard {...liveProps} projects={projects} buildableProjects={[{ name: "安装运抵的太阳能设施", description: "把运抵的太阳电池阵安装到建设位并并网。" }]}
        selectedProjectId={null} onSelectProject={onSelectProject} />);

    fireEvent.click(screen.getByRole("button", { name: /第二座太阳能阵列/ }));

    expect(onSelectProject).toHaveBeenCalledOnce();
    expect(onSelectProject).toHaveBeenCalledWith("project-2");
  });

  it("没有项目时给出引导文案", () => {
    render(<ProjectBoard {...liveProps} projects={[]} buildableProjects={[{ name: "安装运抵的太阳能设施", description: "把运抵的太阳电池阵安装到建设位并并网。" }]}
        selectedProjectId={null} onSelectProject={() => undefined} />);

    expect(screen.getByText(/当前目标/)).toBeTruthy();
    expect(screen.getByText(/安装运抵的太阳能设施/)).toBeTruthy();
    expect(screen.getByText(/建设位 A/)).toBeTruthy();
  });
});
