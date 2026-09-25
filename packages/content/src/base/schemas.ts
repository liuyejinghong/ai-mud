// M12-D 基地内容 schema 与运行时校验（纯层）。
// A0-04 修正 6：v0.12 的内容能力校验在本文件（content 纯层）完成，catalog 注册表归属 M13-P 再定。
// 本文件不 import @ai-mud/shared，content 保持独立构建；下列自有 interface 与 shared 的
// DefinitionRefDto / RobotTemplateDto / ProjectTemplateDto 以及
// apps/server/src/application/base/ports.ts 的 ProvisionSeedDto 逐字段兼容
// （字段名逐字一致；如 shared 侧改名须回 P 握手，见 docs/reviews/base-operations/m12-p-contract.md §4）。
// 精度合同与 shared 一致：功率一律 W、电量一律 Wh 的整数定点。

export const CONTENT_ROBOT_GROUP_IDS = ["transport", "engineering", "survey"] as const;
export type ContentRobotGroupId = (typeof CONTENT_ROBOT_GROUP_IDS)[number];

// 与 shared STEP_KINDS 同步：site_clearing → transport → installation → commissioning。
export const CONTENT_STEP_KINDS = ["site_clearing", "transport", "installation", "commissioning"] as const;
export type ContentStepKind = (typeof CONTENT_STEP_KINDS)[number];

// ProvisionSeedDto.sites[].state 的种子期取值（运行期另有 "reserved"，不属于内容包）。
export const CONTENT_SEED_SITE_STATES = ["free", "built"] as const;
export type ContentSeedSiteState = (typeof CONTENT_SEED_SITE_STATES)[number];

export interface ContentDefinitionRef {
  kind: "robot_template" | "project" | "facility" | "recipe" | "order";
  stableId: string;
  revision: number;
}

export interface ContentRobotTemplate {
  ref: ContentDefinitionRef;
  name: string;
  groupId: ContentRobotGroupId;
  description: string;
  batteryCapacityWh: number;
  chargeRateW: number;
  // 单位：工作点 / 基地分钟（字段名沿用历史的 "PerTick"，这里的 tick = 1 个基地分钟，
  // 不是结算调用次数）。结算按跨过的整基地分钟边界计工作量，与子 tick 切分、调用频率无关
  // （2026-09-25 B008）。出工每基地分钟另耗 ROBOT_WORK_DRAIN_WH（运行侧规则常量）。
  workRatePerTick: number;
}

export interface ContentProjectStepTemplate {
  kind: ContentStepKind;
  groupId: ContentRobotGroupId;
  // 单位：工作点（与 workRatePerTick 同单位；所需基地分钟 = workRequired / 该组出工合计速率）。
  workRequired: number;
}

export interface ContentProjectInput {
  itemId: string;
  quantity: number;
}

export interface ContentProjectTemplate {
  ref: ContentDefinitionRef;
  name: string;
  description: string;
  steps: ContentProjectStepTemplate[];
  inputs: ContentProjectInput[];
  outputFacility: {
    ref: ContentDefinitionRef;
    name: string;
    generationWPeak: number;
  };
}

export interface ContentProvisionSeedDevice {
  templateStableId: string;
  groupId: ContentRobotGroupId;
  count: number;
  initialBatteryWh: number;
}

export interface ContentProvisionSeedSite {
  siteKey: string;
  name: string;
  state: ContentSeedSiteState;
  facilityRef?: ContentDefinitionRef;
}

export interface ContentProvisionSeed {
  releaseId: string;
  baseName: string;
  power: {
    generationWPeak: number;
    storageCapacityWh: number;
    initialStorageWh: number;
  };
  sites: ContentProvisionSeedSite[];
  inventory: ContentProjectInput[];
  devices: ContentProvisionSeedDevice[];
}

// 一个内容 release 的整体形状：content-catalog 启动时对它全量跑校验谓词。
export interface ContentBaseRelease {
  releaseId: string;
  itemNames: Record<string, ContentItemInfo>;
  robots: ContentRobotTemplate[];
  projects: ContentProjectTemplate[];
  recipes: ContentRecipeTemplate[];
  orderTemplates: ContentOrderTemplate[];
  provisionSeed: ContentProvisionSeed;
}

// ---------- 运行时校验谓词 ----------
// 约定：返回错误列表，空数组 = 通过。字段级白名单同时承担"无第二发电来源"（Q-01）
// 的结构封禁——模板/种子对象上除登记字段外的任何多余字段（含 generationWPeak）一律报错，
// 全 release 只允许 seed.power.generationWPeak 与 project.outputFacility.generationWPeak 两处发电声明。

function isPositiveInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value > 0;
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

function collectUnknownKeys(
  source: object,
  allowedKeys: readonly string[],
  label: string,
  errors: string[]
): void {
  for (const key of Object.keys(source)) {
    if (!allowedKeys.includes(key)) {
      errors.push(`${label} has unknown field "${key}" (no second generation source may be declared here)`);
    }
  }
}

function validateDefinitionRef(
  ref: unknown,
  expectedKind: ContentDefinitionRef["kind"],
  label: string,
  errors: string[]
): void {
  if (typeof ref !== "object" || ref === null) {
    errors.push(`${label}.ref must be an object`);
    return;
  }
  const candidate = ref as Partial<ContentDefinitionRef>;
  if (candidate.kind !== expectedKind) {
    errors.push(`${label}.ref.kind must be "${expectedKind}"`);
  }
  if (!isNonEmptyString(candidate.stableId)) {
    errors.push(`${label}.ref.stableId must be a non-empty string`);
  }
  if (!isPositiveInteger(candidate.revision)) {
    errors.push(`${label}.ref.revision must be an integer >= 1`);
  }
}

function hasGenerationField(source: object): boolean {
  return Object.keys(source).some((key) => key.toLowerCase().includes("generation"));
}

const ROBOT_TEMPLATE_KEYS = [
  "ref",
  "name",
  "groupId",
  "description",
  "batteryCapacityWh",
  "chargeRateW",
  "workRatePerTick"
] as const;

export function validateRobotTemplate(template: ContentRobotTemplate): string[] {
  const errors: string[] = [];
  const label = `robot template "${template.ref?.stableId ?? "?"}"`;

  collectUnknownKeys(template, ROBOT_TEMPLATE_KEYS, label, errors);
  if (hasGenerationField(template)) {
    errors.push(`${label} must not declare generation fields (robots never generate power)`);
  }

  validateDefinitionRef(template.ref, "robot_template", label, errors);
  if (!isNonEmptyString(template.name)) {
    errors.push(`${label}.name must be a non-empty string`);
  }
  if (!CONTENT_ROBOT_GROUP_IDS.includes(template.groupId)) {
    errors.push(`${label}.groupId must be one of ${CONTENT_ROBOT_GROUP_IDS.join("/")}`);
  }
  if (!isNonEmptyString(template.description)) {
    errors.push(`${label}.description must be a non-empty string`);
  }
  for (const field of ["batteryCapacityWh", "chargeRateW", "workRatePerTick"] as const) {
    if (!isPositiveInteger(template[field])) {
      errors.push(`${label}.${field} must be a positive integer`);
    }
  }
  return errors;
}

const PROJECT_TEMPLATE_KEYS = ["ref", "name", "description", "steps", "inputs", "outputFacility"] as const;
const PROJECT_STEP_KEYS = ["kind", "groupId", "workRequired"] as const;
const OUTPUT_FACILITY_KEYS = ["ref", "name", "generationWPeak"] as const;

export function validateProjectTemplate(template: ContentProjectTemplate): string[] {
  const errors: string[] = [];
  const label = `project template "${template.ref?.stableId ?? "?"}"`;

  collectUnknownKeys(template, PROJECT_TEMPLATE_KEYS, label, errors);
  if (hasGenerationField(template)) {
    errors.push(
      `${label} must not declare generation fields outside outputFacility (no second generation source)`
    );
  }

  validateDefinitionRef(template.ref, "project", label, errors);
  if (!isNonEmptyString(template.name)) {
    errors.push(`${label}.name must be a non-empty string`);
  }
  if (!isNonEmptyString(template.description)) {
    errors.push(`${label}.description must be a non-empty string`);
  }

  const steps = template.steps;
  if (!Array.isArray(steps) || steps.length === 0) {
    errors.push(`${label}.steps must be a non-empty array`);
  } else {
    steps.forEach((step, index) => {
      const stepLabel = `${label}.steps[${index}]`;
      collectUnknownKeys(step, PROJECT_STEP_KEYS, stepLabel, errors);
      if (!CONTENT_STEP_KINDS.includes(step.kind)) {
        errors.push(`${stepLabel}.kind must be one of ${CONTENT_STEP_KINDS.join("/")}`);
      }
      if (!CONTENT_ROBOT_GROUP_IDS.includes(step.groupId)) {
        errors.push(`${stepLabel}.groupId must be one of ${CONTENT_ROBOT_GROUP_IDS.join("/")}`);
      }
      if (!isPositiveInteger(step.workRequired)) {
        errors.push(`${stepLabel}.workRequired must be a positive integer`);
      }
    });
    if (steps[0]!.kind !== "site_clearing") {
      errors.push(`${label}.steps[0].kind must be "site_clearing"`);
    }
    if (steps[steps.length - 1]!.kind !== "commissioning") {
      errors.push(`${label}.steps must end with kind "commissioning"`);
    }
  }

  const inputs = template.inputs;
  if (!Array.isArray(inputs) || inputs.length === 0) {
    errors.push(`${label}.inputs must be a non-empty array`);
  } else {
    const seenItemIds = new Set<string>();
    inputs.forEach((input, index) => {
      const inputLabel = `${label}.inputs[${index}]`;
      if (!isNonEmptyString(input.itemId)) {
        errors.push(`${inputLabel}.itemId must be a non-empty string`);
      }
      if (!isPositiveInteger(input.quantity)) {
        errors.push(`${inputLabel}.quantity must be a positive integer`);
      }
      if (isNonEmptyString(input.itemId) && seenItemIds.has(input.itemId)) {
        errors.push(`${inputLabel} duplicates itemId "${input.itemId}"`);
      }
      if (isNonEmptyString(input.itemId)) {
        seenItemIds.add(input.itemId);
      }
    });
  }

  const facility = template.outputFacility;
  if (typeof facility !== "object" || facility === null) {
    errors.push(`${label}.outputFacility must be an object`);
  } else {
    collectUnknownKeys(facility, OUTPUT_FACILITY_KEYS, `${label}.outputFacility`, errors);
    validateDefinitionRef(facility.ref, "facility", `${label}.outputFacility`, errors);
    if (!isNonEmptyString(facility.name)) {
      errors.push(`${label}.outputFacility.name must be a non-empty string`);
    }
    if (!isPositiveInteger(facility.generationWPeak)) {
      errors.push(`${label}.outputFacility.generationWPeak must be a positive integer`);
    }
  }
  return errors;
}

const SEED_KEYS = ["releaseId", "baseName", "power", "sites", "inventory", "devices"] as const;
const SEED_POWER_KEYS = ["generationWPeak", "storageCapacityWh", "initialStorageWh"] as const;
const SEED_SITE_KEYS = ["siteKey", "name", "state", "facilityRef"] as const;
const SEED_DEVICE_KEYS = ["templateStableId", "groupId", "count", "initialBatteryWh"] as const;

export function validateProvisionSeed(
  seed: ContentProvisionSeed,
  robots: readonly ContentRobotTemplate[],
  projects: readonly ContentProjectTemplate[]
): string[] {
  const errors: string[] = [];
  const label = `provision seed "${seed.releaseId ?? "?"}"`;

  collectUnknownKeys(seed, SEED_KEYS, label, errors);
  if (!isNonEmptyString(seed.releaseId)) {
    errors.push(`${label}.releaseId must be a non-empty string`);
  }
  if (!isNonEmptyString(seed.baseName)) {
    errors.push(`${label}.baseName must be a non-empty string`);
  }

  const power = seed.power;
  if (typeof power !== "object" || power === null) {
    errors.push(`${label}.power must be an object`);
  } else {
    collectUnknownKeys(power, SEED_POWER_KEYS, `${label}.power`, errors);
    for (const field of ["generationWPeak", "storageCapacityWh", "initialStorageWh"] as const) {
      if (!isPositiveInteger(power[field])) {
        errors.push(`${label}.power.${field} must be a positive integer`);
      }
    }
    if (
      isPositiveInteger(power.initialStorageWh) &&
      isPositiveInteger(power.storageCapacityWh) &&
      power.initialStorageWh > power.storageCapacityWh
    ) {
      errors.push(`${label}.power.initialStorageWh must not exceed storageCapacityWh`);
    }
  }

  const sites = seed.sites;
  if (!Array.isArray(sites) || sites.length === 0) {
    errors.push(`${label}.sites must be a non-empty array`);
  } else {
    const seenSiteKeys = new Set<string>();
    let freeSiteCount = 0;
    sites.forEach((site, index) => {
      const siteLabel = `${label}.sites[${index}]`;
      collectUnknownKeys(site, SEED_SITE_KEYS, siteLabel, errors);
      if (!isNonEmptyString(site.name)) {
        errors.push(`${siteLabel}.name must be a non-empty string`);
      }
      if (!isNonEmptyString(site.siteKey)) {
        errors.push(`${siteLabel}.siteKey must be a non-empty string`);
      } else {
        if (seenSiteKeys.has(site.siteKey)) {
          errors.push(`${siteLabel} duplicates siteKey "${site.siteKey}"`);
        }
        seenSiteKeys.add(site.siteKey);
      }
      if (!CONTENT_SEED_SITE_STATES.includes(site.state)) {
        errors.push(`${siteLabel}.state must be one of ${CONTENT_SEED_SITE_STATES.join("/")}`);
      }
      if (site.state === "built") {
        if (site.facilityRef === undefined) {
          errors.push(`${siteLabel} is "built" and must carry a facilityRef`);
        } else {
          validateDefinitionRef(site.facilityRef, "facility", siteLabel, errors);
        }
      } else if (site.facilityRef !== undefined) {
        errors.push(`${siteLabel} is not "built" and must not carry a facilityRef`);
      }
      if (site.state === "free") {
        freeSiteCount += 1;
      }
    });
    if (freeSiteCount === 0) {
      errors.push(`${label}.sites must contain at least one "free" site`);
    }
  }

  const inventory = seed.inventory;
  if (!Array.isArray(inventory) || inventory.length === 0) {
    errors.push(`${label}.inventory must be a non-empty array`);
  } else {
    const inventoryQuantityByItemId = new Map<string, number>();
    inventory.forEach((entry, index) => {
      const entryLabel = `${label}.inventory[${index}]`;
      if (!isNonEmptyString(entry.itemId)) {
        errors.push(`${entryLabel}.itemId must be a non-empty string`);
      }
      if (!isPositiveInteger(entry.quantity)) {
        errors.push(`${entryLabel}.quantity must be a positive integer`);
      }
      if (isNonEmptyString(entry.itemId)) {
        if (inventoryQuantityByItemId.has(entry.itemId)) {
          errors.push(`${entryLabel} duplicates itemId "${entry.itemId}"`);
        }
        inventoryQuantityByItemId.set(entry.itemId, entry.quantity);
      }
    });

    const firstProject = projects[0];
    if (firstProject !== undefined) {
      for (const input of firstProject.inputs) {
        const available = inventoryQuantityByItemId.get(input.itemId) ?? 0;
        if (available < input.quantity) {
          errors.push(
            `${label}.inventory has ${available} of "${input.itemId}" but first project "${firstProject.ref.stableId}" needs ${input.quantity}`
          );
        }
      }
    }
  }

  const robotByStableId = new Map(robots.map((robot) => [robot.ref.stableId, robot]));
  const devices = seed.devices;
  if (!Array.isArray(devices) || devices.length === 0) {
    errors.push(`${label}.devices must be a non-empty array`);
  } else {
    devices.forEach((device, index) => {
      const deviceLabel = `${label}.devices[${index}]`;
      collectUnknownKeys(device, SEED_DEVICE_KEYS, deviceLabel, errors);
      if (!isNonEmptyString(device.templateStableId)) {
        errors.push(`${deviceLabel}.templateStableId must be a non-empty string`);
      }
      if (!isPositiveInteger(device.count)) {
        errors.push(`${deviceLabel}.count must be a positive integer`);
      }
      const template =
        isNonEmptyString(device.templateStableId)
          ? robotByStableId.get(device.templateStableId)
          : undefined;
      if (template === undefined) {
        errors.push(
          `${deviceLabel} references undefined robot template "${String(device.templateStableId)}"`
        );
      } else {
        if (device.groupId !== template.groupId) {
          errors.push(
            `${deviceLabel}.groupId must match template "${template.ref.stableId}" group "${template.groupId}"`
          );
        }
        if (!Number.isInteger(device.initialBatteryWh) || device.initialBatteryWh < 0) {
          errors.push(`${deviceLabel}.initialBatteryWh must be a non-negative integer`);
        } else if (device.initialBatteryWh > template.batteryCapacityWh) {
          errors.push(
            `${deviceLabel}.initialBatteryWh must not exceed template capacity ${template.batteryCapacityWh}Wh`
          );
        }
      }
    });
  }
  return errors;
}

export function validateItemNames(
  itemNames: Record<string, ContentItemInfo>,
  seed: ContentProvisionSeed,
  projects: readonly ContentProjectTemplate[]
): string[] {
  const errors: string[] = [];
  const entries = Object.entries(itemNames ?? {});
  if (entries.length === 0) {
    errors.push("itemNames must not be empty");
  }
  for (const [itemId, info] of entries) {
    if (!isNonEmptyString(itemId) || !info || !isNonEmptyString(info.name) || !isNonEmptyString(info.description)) {
      errors.push(`itemNames["${String(itemId)}"] must map an id to a non-empty name and description`);
    }
  }
  for (const entry of seed.inventory) {
    const info = itemNames?.[entry.itemId];
    if (!info || !isNonEmptyString(info.name)) {
      errors.push(`itemNames is missing a display name for inventory item "${entry.itemId}"`);
    }
  }
  for (const project of projects) {
    for (const input of project.inputs) {
      const inputInfo = itemNames?.[input.itemId];
      if (!inputInfo || !isNonEmptyString(inputInfo.name)) {
        errors.push(`itemNames is missing a display name for project input "${input.itemId}"`);
      }
    }
  }
  return errors;
}

export interface ContentRecipeTemplate {
  ref: ContentDefinitionRef;
  name: string;
  description: string;
  inputs: Array<{ itemId: string; quantity: number }>;
  // 单位：工作点 / 台；制造工作点 = 电力池分给制造的能量 Wh（1:1，制造负载 1500W → 25 点/基地分钟，
  // 同基地多张工单 FIFO 分摊；m13-p-contract §4）。
  workPerUnit: number;
  output: { templateStableId: string; initialBatteryWh: number };
}

export interface ContentOrderTemplate {
  ref: ContentDefinitionRef;
  name: string;
  description: string;
  requiredItemId: string;
  quantity: number;
  rewardCredits: number;
  deadlineSimHours: number;
}

export interface ContentItemInfo {
  name: string;
  description: string;
}

export interface ContentFacilityInfo {
  name: string;
  // 地图卡片上的一句话功能短语（替代干巴巴的"设施已建成"）。
  note: string;
  description: string;
  attributes: Array<{ label: string; value: string }>;
}

const RECIPE_KEYS = [
  "ref",
  "name",
  "description",
  "inputs",
  "workPerUnit",
  "output"
] as const;

export function validateRecipeTemplate(recipe: ContentRecipeTemplate): string[] {
  const errors: string[] = [];
  const label = `recipe "${recipe.ref?.stableId ?? "?"}"`;
  collectUnknownKeys(recipe, RECIPE_KEYS, label, errors);
  validateDefinitionRef(recipe.ref, "recipe", label, errors);
  if (!isNonEmptyString(recipe.name)) {
    errors.push(`${label}.name must be a non-empty string`);
  }
  if (!isNonEmptyString(recipe.description)) {
    errors.push(`${label}.description must be a non-empty string`);
  }
  if (!Array.isArray(recipe.inputs) || recipe.inputs.length === 0) {
    errors.push(`${label}.inputs must be a non-empty array`);
  } else {
    const seen = new Set<string>();
    for (const input of recipe.inputs) {
      if (!isNonEmptyString(input.itemId)) {
        errors.push(`${label}.inputs itemId must be a non-empty string`);
      } else if (seen.has(input.itemId)) {
        errors.push(`${label} duplicates input itemId "${input.itemId}"`);
      } else {
        seen.add(input.itemId);
      }
      if (!isPositiveInteger(input.quantity)) {
        errors.push(`${label}.inputs quantity must be a positive integer`);
      }
    }
  }
  if (!isPositiveInteger(recipe.workPerUnit)) {
    errors.push(`${label}.workPerUnit must be a positive integer`);
  }
  const output = recipe.output;
  if (typeof output !== "object" || output === null) {
    errors.push(`${label}.output must be an object`);
  } else {
    collectUnknownKeys(output, ["templateStableId", "initialBatteryWh"], `${label}.output`, errors);
    if (!isNonEmptyString(output.templateStableId)) {
      errors.push(`${label}.output.templateStableId must be a non-empty string`);
    }
    if (!isPositiveInteger(output.initialBatteryWh)) {
      errors.push(`${label}.output.initialBatteryWh must be a positive integer`);
    }
  }
  return errors;
}

const ORDER_KEYS = [
  "ref",
  "name",
  "description",
  "requiredItemId",
  "quantity",
  "rewardCredits",
  "deadlineSimHours"
] as const;

export function validateOrderTemplate(order: ContentOrderTemplate): string[] {
  const errors: string[] = [];
  const label = `order "${order.ref?.stableId ?? "?"}"`;
  collectUnknownKeys(order, ORDER_KEYS, label, errors);
  validateDefinitionRef(order.ref, "order", label, errors);
  if (!isNonEmptyString(order.name)) {
    errors.push(`${label}.name must be a non-empty string`);
  }
  if (!isNonEmptyString(order.description)) {
    errors.push(`${label}.description must be a non-empty string`);
  }
  if (!isNonEmptyString(order.requiredItemId)) {
    errors.push(`${label}.requiredItemId must be a non-empty string`);
  }
  if (!isPositiveInteger(order.quantity)) {
    errors.push(`${label}.quantity must be a positive integer`);
  }
  if (!isPositiveInteger(order.rewardCredits)) {
    errors.push(`${label}.rewardCredits must be a positive integer`);
  }
  if (!isPositiveInteger(order.deadlineSimHours)) {
    errors.push(`${label}.deadlineSimHours must be a positive integer`);
  }
  return errors;
}
