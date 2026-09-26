// 将内容 release 映射成只读目录；装载时校验整包定义，损坏内容直接报错。
import {
  BASE_FACILITY_INFO as FACILITY_INFO,
  DEFAULT_BASE_CONTENT_RELEASE,
  TUTORIAL_BASE_RELEASE_ID,
  type ContentItemInfo,
  type ContentOrderTemplate,
  type ContentRecipeTemplate,
  validateItemNames,
  validateOrderTemplate,
  validateRecipeTemplate,
  validateProjectTemplate,
  validateProvisionSeed,
  validateRobotTemplate,
  type ContentBaseRelease,
  type ContentProjectTemplate,
  type ContentProvisionSeed,
  type ContentRobotTemplate,
  type ContentRulesProfile
} from "@ai-mud/content";
import type { OrderTemplateDto, ProjectTemplateDto, RecipeTemplateDto, RobotTemplateDto } from "@ai-mud/shared";
// 结构等价镜像 application/base/ports.ts 的 ContentCatalogPort（content-catalog 不允许
// 依赖 application；composition 按结构绑定，漂移由 catalog.service.test.ts 锁定）。
interface ProvisionSeedSiteDto {
  siteKey: string;
  name: string;
  state: "free" | "built";
  facilityRef?: { kind: "project" | "robot_template" | "facility" | "recipe" | "order"; stableId: string; revision: number };
}

interface ProvisionSeedDto {
  releaseId: string;
  baseName: string;
  power: {
    generationWPeak: number;
    storageCapacityWh: number;
    initialStorageWh: number;
    emergencyGenerationW?: number;
    baseLoadW?: number;
    chargeLimitW?: number;
    initialDustLevel?: number;
  };
  sites: ProvisionSeedSiteDto[];
  inventory: Array<{ itemId: string; quantity: number }>;
  devices: Array<{
    templateStableId: string;
    groupId: string;
    count: number;
    initialBatteryWh: number;
  }>;
  initialCredits?: number;
  resourceNodes?: Array<{ nodeKey: string; name: string; itemId: string; initialQuantity: number }>;
}

export interface ContentCatalogPort {
  releaseId(): string;
  getItemInfo(): Record<string, ContentItemInfo>;
  getRecipeTemplate(stableId: string, revision?: number): RecipeTemplateDto | null;
  listRecipes(): RecipeTemplateDto[];
  getOrderTemplate(stableId: string): OrderTemplateDto | null;
  listOrderTemplates(): OrderTemplateDto[];
  getFacilityInfo(stableId: string): {
    name: string;
    note: string;
    description: string;
    attributes: Array<{ label: string; value: string }>;
  } | null;
  getRobotTemplate(stableId: string): RobotTemplateDto | null;
  getProjectTemplate(stableId: string): ProjectTemplateDto | null;
  listTemplates(): { robots: RobotTemplateDto[]; projects: ProjectTemplateDto[] };
  getProvisionSeed(): ProvisionSeedDto;
  // R1：规则档位与能力位（缺省 legacy / ["external_trade"]）。
  rulesProfile(): ContentRulesProfile;
  capabilities(): string[];
}

function toRobotTemplateDto(template: ContentRobotTemplate): RobotTemplateDto {
  return {
    ref: { ...template.ref },
    name: template.name,
    groupId: template.groupId,
    description: template.description,
    batteryCapacityWh: template.batteryCapacityWh,
    chargeRateW: template.chargeRateW,
    workRatePerTick: template.workRatePerTick,
    ...(template.workDrainWhPerTick !== undefined
      ? { workDrainWhPerTick: template.workDrainWhPerTick }
      : {})
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
      ...(template.outputFacility.generationWPeak !== undefined
        ? { generationWPeak: template.outputFacility.generationWPeak }
        : {}),
      ...(template.outputFacility.effects !== undefined
        ? { effects: { ...template.outputFacility.effects } }
        : {})
    },
    ...(template.requiresFacilities !== undefined
      ? { requiresFacilities: [...template.requiresFacilities] }
      : {}),
    ...(template.expansionSlot !== undefined ? { expansionSlot: template.expansionSlot } : {})
  };
}

function toProvisionSeedDto(seed: ContentProvisionSeed): ProvisionSeedDto {
  const sites: ProvisionSeedSiteDto[] = seed.sites.map((site) => {
    if (site.facilityRef === undefined) {
      return { siteKey: site.siteKey, name: site.name, state: site.state };
    }
    return {
      siteKey: site.siteKey,
      name: site.name,
      state: site.state,
      facilityRef: { ...site.facilityRef }
    };
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

function toRecipeTemplateDto(recipe: ContentRecipeTemplate): RecipeTemplateDto {
  // 目录边界规范化：旧机器人输出（无 kind）补 kind:"robot"；item 输出原样。
  const rawOutput = recipe.output;
  const output =
    "itemId" in rawOutput
      ? { kind: "item" as const, itemId: rawOutput.itemId, quantity: rawOutput.quantity }
      : {
          kind: "robot" as const,
          templateStableId: rawOutput.templateStableId,
          initialBatteryWh: rawOutput.initialBatteryWh
        };
  return {
    ref: { ...recipe.ref },
    name: recipe.name,
    description: recipe.description,
    inputs: recipe.inputs.map((input) => ({ ...input })),
    workPerUnit: recipe.workPerUnit,
    output,
    ...(recipe.ratedW !== undefined ? { ratedW: recipe.ratedW } : {}),
    ...(recipe.workMinutesPerBatch !== undefined
      ? { workMinutesPerBatch: recipe.workMinutesPerBatch }
      : {}),
    ...(recipe.requiredCapability !== undefined
      ? { requiredCapability: recipe.requiredCapability }
      : {}),
    ...(recipe.countsSlotMaintenance !== undefined
      ? { countsSlotMaintenance: recipe.countsSlotMaintenance }
      : {})
  };
}

function toOrderTemplateDto(order: ContentOrderTemplate): OrderTemplateDto {
  return {
    ref: { ...order.ref },
    name: order.name,
    description: order.description,
    requiredItemId: order.requiredItemId,
    quantity: order.quantity,
    rewardCredits: order.rewardCredits,
    deadlineSimHours: order.deadlineSimHours
  };
}

function assertReleaseValid(release: ContentBaseRelease): void {
  const failures: string[] = [];
  for (const order of release.orderTemplates ?? []) {
    const errors = validateOrderTemplate(order);
    if (errors.length > 0) {
      failures.push(`order "${order.ref?.stableId ?? "?"}": ${errors.join("; ")}`);
    }
  }
  for (const recipe of release.recipes ?? []) {
    const errors = validateRecipeTemplate(recipe);
    if (errors.length > 0) {
      failures.push(`recipe "${recipe.ref?.stableId ?? "?"}": ${errors.join("; ")}`);
    }
  }
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
  const nameErrors = validateItemNames(release.itemNames, release.provisionSeed, release.projects);
  if (nameErrors.length > 0) {
    failures.push(...nameErrors);
  }
  const seedErrors = validateProvisionSeed(
    release.provisionSeed,
    release.robots,
    release.projects,
    release.itemNames
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

// 无 revision 只给当前可创建配方；显式 revision 用于读取已在途工单。
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
  const recipesByStableId = new Map(
    release.recipes.map((recipe) => [recipe.ref.stableId, recipe] as const)
  );
  const ordersByStableId = new Map(
    release.orderTemplates.map((order) => [order.ref.stableId, order] as const)
  );

  return {
    releaseId: () => release.releaseId,
    rulesProfile: () => release.rulesProfile ?? "legacy",
    capabilities: () => [...(release.capabilities ?? ["external_trade"])],
    getRobotTemplate: (stableId: string): RobotTemplateDto | null => {
      const robot = robotsByStableId.get(stableId);
      return robot === undefined ? null : toRobotTemplateDto(robot);
    },
    getProjectTemplate: (stableId: string): ProjectTemplateDto | null => {
      const project = projectsByStableId.get(stableId);
      return project === undefined ? null : toProjectTemplateDto(project);
    },
    getRecipeTemplate: (stableId: string, revision?: number): RecipeTemplateDto | null => {
      const current = recipesByStableId.get(stableId);
      if (revision === undefined || current?.ref.revision === revision) {
        return current === undefined ? null : toRecipeTemplateDto(current);
      }
      const archived = release.releaseId === TUTORIAL_BASE_RELEASE_ID
        ? DEFAULT_BASE_CONTENT_RELEASE.recipes.find(
            (recipe) => recipe.ref.stableId === stableId && recipe.ref.revision === revision
          )
        : undefined;
      return archived === undefined ? null : toRecipeTemplateDto(archived);
    },
    listRecipes: (): RecipeTemplateDto[] => release.recipes.map(toRecipeTemplateDto),
    getOrderTemplate: (stableId: string): OrderTemplateDto | null => {
      const order = ordersByStableId.get(stableId);
      return order === undefined ? null : toOrderTemplateDto(order);
    },
    listOrderTemplates: (): OrderTemplateDto[] => release.orderTemplates.map(toOrderTemplateDto),
    listTemplates: () => ({
      robots: release.robots.map(toRobotTemplateDto),
      projects: release.projects.map(toProjectTemplateDto)
    }),
    getProvisionSeed: (): ProvisionSeedDto => toProvisionSeedDto(release.provisionSeed),
    getItemInfo: (): Record<string, ContentItemInfo> =>
      Object.fromEntries(Object.entries(release.itemNames).map(([id, info]) => [id, { ...info }])),
    getFacilityInfo: (stableId: string) => {
      const info = release.facilityInfo?.[stableId] ?? FACILITY_INFO[stableId];
      return info ? { ...info, attributes: info.attributes.map((a) => ({ ...a })) } : null;
    }
  };
}
