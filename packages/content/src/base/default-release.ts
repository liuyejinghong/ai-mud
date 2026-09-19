// M12-D 默认内容 release（唯一数据来源：docs/reviews/base-operations/m12-p-contract.md §4 fixture）。
// Q-01 纯储能过夜：开局唯一发电来源是种子里的初始阵列 15000W（昼间 ×0.9 积尘系数由运行侧
// industry.pure 纯规则持有，不进内容包）；机器人模板不携带任何发电字段。
// 数值全部为"游戏初值"，修改须回 P 握手。
import type {
  ContentBaseRelease,
  ContentProjectTemplate,
  ContentProvisionSeed,
  ContentRobotTemplate
} from "./schemas.js";

export const RELEASE_ID = "yudian-base-0";

// ---------- 机器人模板（stableId@revision 1） ----------
// fixture：YD-H1 驮运（transport，20000Wh，充电 4000W，work 1/tick）×4；
//          YD-E1 筑垒（engineering，30000Wh，6000W，1）×5；
//          YD-S1 望山（survey，10000Wh，2000W，1）×3。期初电量 60%。
export const BASE_ROBOT_TEMPLATES: ContentRobotTemplate[] = [
  {
    ref: { kind: "robot_template", stableId: "yd-h1", revision: 1 },
    name: "驮运",
    groupId: "transport",
    description: "负责营地内物资转运的驮运机器人，电池厚实、充电稳健。",
    batteryCapacityWh: 20000,
    chargeRateW: 4000,
    workRatePerTick: 1
  },
  {
    ref: { kind: "robot_template", stableId: "yd-e1", revision: 1 },
    name: "筑垒",
    groupId: "engineering",
    description: "承担清场与安装等重体力工序的筑垒工程机器人。",
    batteryCapacityWh: 30000,
    chargeRateW: 6000,
    workRatePerTick: 1
  },
  {
    ref: { kind: "robot_template", stableId: "yd-s1", revision: 1 },
    name: "望山",
    groupId: "survey",
    description: "执行勘测与验收作业的望山巡检机器人，功耗最低。",
    batteryCapacityWh: 10000,
    chargeRateW: 2000,
    workRatePerTick: 1
  }
];

// ---------- 项目模板（首项目 install-solar-array@1） ----------
// 步骤：清场 engineering 40 → 运输 transport 60 → 安装 engineering 80 → 验收 survey 20。
export const BASE_PROJECT_TEMPLATES: ContentProjectTemplate[] = [
  {
    ref: { kind: "project", stableId: "install-solar-array", revision: 1 },
    name: "安装运抵的太阳能设施",
    description: "把首批货运送达的太阳能设施清场、转运、安装，并通过验收并网。",
    steps: [
      { kind: "site_clearing", groupId: "engineering", workRequired: 40 },
      { kind: "transport", groupId: "transport", workRequired: 60 },
      { kind: "installation", groupId: "engineering", workRequired: 80 },
      { kind: "commissioning", groupId: "survey", workRequired: 20 }
    ],
    inputs: [
      { itemId: "solar_panel_set", quantity: 6 },
      { itemId: "support_frame", quantity: 6 },
      { itemId: "cable", quantity: 2 },
      { itemId: "power_box", quantity: 1 },
      { itemId: "anchor", quantity: 8 }
    ],
    outputFacility: {
      ref: { kind: "facility", stableId: "solar-array-unit", revision: 1 },
      name: "太阳能阵列单元",
      generationWPeak: 5000
    }
  }
];

// ---------- 开局种子 ----------
// power：初始阵列 15000W；储能容量 200000Wh，期初 100000Wh。
// sites：array/storage/warehouse/maintenance/charging 均 built，site_a 为首个 free 工程位。
// inventory：首项目 inputs 各如数 + spare_parts×30。
// devices：yd-h1×4（12000Wh）、yd-e1×5（18000Wh）、yd-s1×3（6000Wh），期初电量 60%。
export const BASE_PROVISION_SEED: ContentProvisionSeed = {
  releaseId: RELEASE_ID,
  baseName: "先遣前哨",
  power: {
    generationWPeak: 15000,
    storageCapacityWh: 200000,
    initialStorageWh: 100000
  },
  sites: [
    {
      siteKey: "array",
      name: "太阳能阵列",
      state: "built",
      facilityRef: { kind: "facility", stableId: "yudian-array", revision: 1 }
    },
    {
      siteKey: "storage",
      name: "储能间",
      state: "built",
      facilityRef: { kind: "facility", stableId: "yudian-storage", revision: 1 }
    },
    {
      siteKey: "warehouse",
      name: "仓储棚",
      state: "built",
      facilityRef: { kind: "facility", stableId: "yudian-warehouse", revision: 1 }
    },
    {
      siteKey: "maintenance",
      name: "维护工位",
      state: "built",
      facilityRef: { kind: "facility", stableId: "yudian-maintenance", revision: 1 }
    },
    {
      siteKey: "charging",
      name: "充电区",
      state: "built",
      facilityRef: { kind: "facility", stableId: "yudian-charging", revision: 1 }
    },
    { siteKey: "site_a", name: "建设位 A", state: "free" }
  ],
  inventory: [
    { itemId: "solar_panel_set", quantity: 6 },
    { itemId: "support_frame", quantity: 6 },
    { itemId: "cable", quantity: 2 },
    { itemId: "power_box", quantity: 1 },
    { itemId: "anchor", quantity: 8 },
    { itemId: "spare_parts", quantity: 30 }
  ],
  devices: [
    { templateStableId: "yd-h1", groupId: "transport", count: 4, initialBatteryWh: 12000 },
    { templateStableId: "yd-e1", groupId: "engineering", count: 5, initialBatteryWh: 18000 },
    { templateStableId: "yd-s1", groupId: "survey", count: 3, initialBatteryWh: 6000 }
  ]
};

export const BASE_ITEM_NAMES: Record<string, string> = {
  solar_panel_set: "太阳电池阵组件",
  support_frame: "支架结构件",
  cable: "线缆",
  power_box: "配电单元",
  anchor: "锚固件",
  spare_parts: "通用备件"
};

export const DEFAULT_BASE_CONTENT_RELEASE: ContentBaseRelease = {
  releaseId: RELEASE_ID,
  itemNames: BASE_ITEM_NAMES,
  robots: BASE_ROBOT_TEMPLATES,
  projects: BASE_PROJECT_TEMPLATES,
  provisionSeed: BASE_PROVISION_SEED
};
