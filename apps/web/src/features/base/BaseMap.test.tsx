import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { BaseProjectDto, BaseSiteDto } from "@ai-mud/shared";
import { BaseMap } from "./BaseMap.js";

const sites: BaseSiteDto[] = [
  { siteId: "site-array", name: "测试站点", siteKey: "array", state: "built", description: null, attributes: [] },
  { siteId: "site-a", name: "测试站点", siteKey: "site_a", state: "free", description: null, attributes: [] },
  { siteId: "site-b", name: "测试站点", siteKey: "site_b", state: "reserved", description: null, attributes: [] }
];

const projects: BaseProjectDto[] = [
  {
    projectId: "project-done",
    definitionRef: { kind: "project", stableId: "install_storage", revision: 1 },
    name: "扩建仓库",
    status: "completed",
    siteId: "site-array",
    steps: []
  },
  {
    projectId: "project-live",
    definitionRef: { kind: "project", stableId: "install_solar_array", revision: 1 },
    name: "安装太阳能阵列",
    status: "active",
    siteId: "site-b",
    steps: []
  }
];

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(cleanup);

describe("BaseMap", () => {
  it("built 显示已建成项目名，free 显示可建设位，reserved 显示进行中的项目", () => {
    render(<BaseMap sites={sites} projects={projects} selectedSiteId={null} onSelectSite={() => undefined} />);

    expect(screen.getByText("扩建仓库")).toBeTruthy();
    expect(screen.getByText("可建设位")).toBeTruthy();
    expect(screen.getByText("施工中：安装太阳能阵列")).toBeTruthy();
  });

  it("点击站点时回调对应 siteId", () => {
    const onSelectSite = vi.fn();
    render(<BaseMap sites={sites} projects={projects} selectedSiteId={null} onSelectSite={onSelectSite} />);

    fireEvent.click(screen.getByRole("button", { name: /可建设位/ }));

    expect(onSelectSite).toHaveBeenCalledOnce();
    expect(onSelectSite).toHaveBeenCalledWith("site-a");
  });

  it("选中的站点带选中标记", () => {
    render(
      <BaseMap sites={sites} projects={projects} selectedSiteId="site-b" onSelectSite={() => undefined} />
    );

    expect(
      screen.getByRole("button", { name: /施工中：安装太阳能阵列/ }).getAttribute("aria-pressed")
    ).toBe("true");
    expect(
      screen.getByRole("button", { name: /可建设位/ }).getAttribute("aria-pressed")
    ).toBe("false");
  });
});
