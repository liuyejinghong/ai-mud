// M12-D 只读内容目录：把 @ai-mud/content 的默认 release 映射成
// apps/server/src/application/base/ports.ts 冻结的 ContentCatalogPort。
// fail-fast：构造时对 release 全量跑 content 纯层校验谓词，任何失败直接 throw（启动即崩），
// 绝不带病提供目录。v0.12 目录只读内置 release，发布/激活能力属 M13-P。
import {
  DEFAULT_BASE_CONTENT_RELEASE,
  validateProjectTemplate,
  validateProvisionSeed,
  validateRobotTemplate,
  type ContentBaseRelease,
  type ContentProjectTemplate,
  type ContentProvisionSeed,
  type ContentRobotTemplate
} from "@ai-mud/content";
import type { ProjectTemplateDto, RobotTemplateDto } from "@ai-mud/shared";
// 结构等价镜像 application/base/ports.ts 的 ContentCatalogPort（content-catalog 不允许
// 依赖 application；composition 按结构绑定，漂移由 catalog.service.test.ts 锁定）。
interface ProvisionSeedSiteDto {
  siteKey: string;
  state: "free" | "built";
  facilityRef?: { kind: "project" | "robot_template" | "facility"; stableId: string; revision: number };
}

interface ProvisionSeedDto {
  releaseId: string;
  baseName: string;
  power: { generationWPeak: number; storageCapacityWh: number; initialStorageWh: number };
  sites: ProvisionSeedSiteDto[];
  inventory: Array<{ itemId: string; quantity: number }>;
  devices: Array<{
    templateStableId: string;
    groupId: string;
    count: number;
    initialBatteryWh: number;
  }>;
}

export interface ContentCatalogPort {
  releaseId(): string;
  getRobotTemplate(stableId: string): RobotTemplateDto | null;
  getProjectTemplate(stableId: string): ProjectTemplateDto | null;
  listTemplates(): { robots: RobotTemplateDto[]; projects: ProjectTemplateDto[] };
  getProvisionSeed(): ProvisionSeedDto;
}

function toRobotTemplateDto(template: ContentRobotTemplate): RobotTemplateDto {
  return {
    ref: { ...template.ref },
    name: template.name,
    groupId: template.groupId,
    description: template.description,
    batteryCapacityWh: template.batteryCapacityWh,
    chargeRateW: template.chargeRateW,
    workRatePerTick: template.workRatePerTick
  };
}

function toProjectTemplateDto(template: ContentProjectTemplate): ProjectTemplateDto {
  return {
    ref: { ...template.ref },
    name: template.name,
    description: template.description,
    steps: template.steps.map((step) => ({ ...step })),
    inputs: template.inputs.map((input) => ({ ...input })),
    outputFacility: {
      ref: { ...template.outputFacility.ref },
      name: template.outputFacility.name,
      generationWPeak: template.outputFacility.generationWPeak
    }
  };
}

function toProvisionSeedDto(seed: ContentProvisionSeed): ProvisionSeedDto {
  const sites: ProvisionSeedSiteDto[] = seed.sites.map((site) => {
    if (site.facilityRef === undefined) {
      return { siteKey: site.siteKey, state: site.state };
    }
    return { siteKey: site.siteKey, state: site.state, facilityRef: { ...site.facilityRef } };
  });
  return {
    releaseId: seed.releaseId,
    baseName: seed.baseName,
    power: { ...seed.power },
    sites,
    inventory: seed.inventory.map((entry) => ({ ...entry })),
    devices: seed.devices.map((device) => ({ ...device }))
  };
}

function assertReleaseValid(release: ContentBaseRelease): void {
  const failures: string[] = [];
  for (const robot of release.robots) {
    const errors = validateRobotTemplate(robot);
    if (errors.length > 0) {
      failures.push(`robot "${robot.ref?.stableId ?? "?"}": ${errors.join("; ")}`);
    }
  }
  for (const project of release.projects) {
    const errors = validateProjectTemplate(project);
    if (errors.length > 0) {
      failures.push(`project "${project.ref?.stableId ?? "?"}": ${errors.join("; ")}`);
    }
  }
  const seedErrors = validateProvisionSeed(
    release.provisionSeed,
    release.robots,
    release.projects
  );
  if (seedErrors.length > 0) {
    failures.push(`provision seed: ${seedErrors.join("; ")}`);
  }
  if (release.provisionSeed.releaseId !== release.releaseId) {
    failures.push(
      `provision seed releaseId "${release.provisionSeed.releaseId}" does not match release "${release.releaseId}"`
    );
  }
  const robotIds = release.robots.map((robot) => robot.ref.stableId);
  if (new Set(robotIds).size !== robotIds.length) {
    failures.push(`duplicate robot template stableIds in release "${release.releaseId}"`);
  }
  const projectIds = release.projects.map((project) => project.ref.stableId);
  if (new Set(projectIds).size !== projectIds.length) {
    failures.push(`duplicate project template stableIds in release "${release.releaseId}"`);
  }
  if (failures.length > 0) {
    throw new Error(
      `content release "${release.releaseId}" failed validation:\n- ${failures.join("\n- ")}`
    );
  }
}

// stableId + 隐含 revision 查询：v0.12 只发布 rev1，运行实例开工时固定所见修订。
export function createContentCatalog(
  release: ContentBaseRelease = DEFAULT_BASE_CONTENT_RELEASE
): ContentCatalogPort {
  assertReleaseValid(release);

  const robotsByStableId = new Map(
    release.robots.map((robot) => [robot.ref.stableId, robot] as const)
  );
  const projectsByStableId = new Map(
    release.projects.map((project) => [project.ref.stableId, project] as const)
  );

  return {
    releaseId: () => release.releaseId,
    getRobotTemplate: (stableId: string): RobotTemplateDto | null => {
      const robot = robotsByStableId.get(stableId);
      return robot === undefined ? null : toRobotTemplateDto(robot);
    },
    getProjectTemplate: (stableId: string): ProjectTemplateDto | null => {
      const project = projectsByStableId.get(stableId);
      return project === undefined ? null : toProjectTemplateDto(project);
    },
    listTemplates: () => ({
      robots: release.robots.map(toRobotTemplateDto),
      projects: release.projects.map(toProjectTemplateDto)
    }),
    getProvisionSeed: (): ProvisionSeedDto => toProvisionSeedDto(release.provisionSeed)
  };
}
