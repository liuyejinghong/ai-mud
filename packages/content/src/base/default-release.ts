// M12-D 默认内容 release（唯一数据来源：docs/reviews/base-operations/m12-p-contract.md §4 fixture）。
// Q-01 纯储能过夜：开局唯一发电来源是种子里的初始阵列 15000W（昼间 ×0.9 积尘系数由运行侧
// industry.pure 纯规则持有，不进内容包）；机器人模板不携带任何发电字段。
// 数值全部为"游戏初值"，修改须回 P 握手。
import type {
  ContentBaseRelease,
  ContentFacilityInfo,
  ContentItemInfo,
  ContentOrderTemplate,
  ContentRecipeTemplate,
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

export const BASE_ITEM_INFO: Record<string, ContentItemInfo> = {
  solar_panel_set: {
    name: "太阳电池阵组件",
    description: "随首批货飞船运抵的折叠式太阳电池阵，安装并网后成为基地的发电设施。"
  },
  support_frame: {
    name: "支架结构件",
    description: "把电池阵举离地面并固定角度的支架，安装作业的主要工作量所在。"
  },
  cable: {
    name: "线缆",
    description: "阵列到配电单元的输电线路，敷设后并网。"
  },
  power_box: {
    name: "配电单元",
    description: "汇流并网设备：把阵列电力接入基地电网，监控输出。"
  },
  anchor: {
    name: "锚固件",
    description: "打地基用的锚固件，清场后固定支架。"
  },
  spare_parts: {
    name: "通用备件",
    description: "维修耗材：关节、电池、紧固件。设备检修时由维护工位消耗。"
  }
};

// 建成设施的内容说明：对象详情里展示的静态属性（运行数据在电力区展示）。
export const BASE_FACILITY_INFO: Record<string, ContentFacilityInfo> = {
  "yudian-array": {
    name: "太阳能阵列",
    note: "昼间为基地供电",
    description: "首批货运部署的太阳电池阵，白天为基地供电。表面积尘会降低出力，需要定期安排巡检清理。",
    attributes: [
      { label: "峰值发电", value: "15.0 kW" },
      { label: "供电时段", value: "昼间（基地时间 06:00–18:00）" },
      { label: "当前状态", value: "运行中，存在积尘衰减" }
    ]
  },
  "yudian-storage": {
    name: "储能间",
    note: "夜间与无光期供电",
    description: "基地的电池储能库：白天存下多余的电，夜间和尘暴期维持基本运转。设备夜间低速充电也靠它。",
    attributes: [
      { label: "容量", value: "200 kWh" },
      { label: "供电时段", value: "夜间 / 无光期" }
    ]
  },
  "yudian-warehouse": {
    name: "仓储棚",
    note: "存放全部物资",
    description: "随船物资和产出物料的存放点。工程队从这里领取建材，完工设施归档运行数据。",
    attributes: [{ label: "存放", value: "全部物资（见顶部物资区）" }]
  },
  "yudian-maintenance": {
    name: "维护工位",
    note: "检修与清尘设备",
    description: "基础维护是前哨的公共职责：检查、清尘、更换关节和电池都在这里进行，消耗通用备件。",
    attributes: [
      { label: "同时维修", value: "2 台设备" },
      { label: "消耗", value: "通用备件" }
    ]
  },
  "yudian-charging": {
    name: "充电区",
    note: "给工程设备充电",
    description: "工程设备的充电桩区。充电功率受基地发电盈余限制，夜间只提供涓流，优先保障基本负荷。",
    attributes: [
      { label: "充电位", value: "4 个" },
      { label: "策略", value: "盈余优先，夜间涓流 2 kW" }
    ]
  },
  "solar-array-unit": {
    name: "太阳能阵列单元",
    note: "昼间为基地供电",
    description: "由工程队现场安装并网的太阳电池阵单元：支架锚固、板组展开、线缆接入配电单元。",
    attributes: [
      { label: "峰值发电", value: "5.0 kW" },
      { label: "供电时段", value: "昼间（基地时间 06:00–18:00）" }
    ]
  }
};

export const BASE_RECIPE_TEMPLATES: ContentRecipeTemplate[] = [
  {
    ref: { kind: "recipe", stableId: "manufacture-yd-h1", revision: 1 },
    name: "制造驮运机器人",
    description: "用结构件、备件和配电单元组装一台驮运工程机器人。",
    inputs: [
      { itemId: "support_frame", quantity: 4 },
      { itemId: "spare_parts", quantity: 6 },
      { itemId: "power_box", quantity: 1 }
    ],
    workPerUnit: 30,
    output: { templateStableId: "yd-h1", initialBatteryWh: 12000 }
  },
  {
    ref: { kind: "recipe", stableId: "manufacture-yd-s1", revision: 1 },
    name: "制造望山巡检机器人",
    description: "用备件与锚固件组装一台轻量勘测巡检机器人。",
    inputs: [
      { itemId: "spare_parts", quantity: 4 },
      { itemId: "anchor", quantity: 3 }
    ],
    workPerUnit: 20,
    output: { templateStableId: "yd-s1", initialBatteryWh: 6000 }
  }
];

export const BASE_ORDER_TEMPLATES: ContentOrderTemplate[] = [
  {
    ref: { kind: "order", stableId: "order-solar-buyback", revision: 1 },
    name: "补给站收购太阳电池组件",
    description: "着陆区补给站长期收购太阳电池组件，交付后结清账款。",
    requiredItemId: "solar_panel_set",
    quantity: 4,
    rewardCredits: 700,
    deadlineSimHours: 48
  },
  {
    ref: { kind: "order", stableId: "order-frame-tender", revision: 1 },
    name: "前哨建设招标：支架结构件",
    description: "第二施工队急需支架结构件，愿意溢价收购。",
    requiredItemId: "support_frame",
    quantity: 6,
    rewardCredits: 500,
    deadlineSimHours: 48
  },
  {
    ref: { kind: "order", stableId: "order-maintenance-restock", revision: 1 },
    name: "设备维护耗材采购",
    description: "维护工位补给通用备件，用于基地设备例行检修。",
    requiredItemId: "spare_parts",
    quantity: 10,
    rewardCredits: 450,
    deadlineSimHours: 72
  }
];

export const DEFAULT_BASE_CONTENT_RELEASE: ContentBaseRelease = {
  releaseId: RELEASE_ID,
  itemNames: BASE_ITEM_INFO,
  robots: BASE_ROBOT_TEMPLATES,
  projects: BASE_PROJECT_TEMPLATES,
  recipes: BASE_RECIPE_TEMPLATES,
  orderTemplates: BASE_ORDER_TEMPLATES,
  provisionSeed: BASE_PROVISION_SEED
};
