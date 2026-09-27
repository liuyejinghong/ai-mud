// R1 着陆重建内容包（yudian-landing-1）。数值合同：docs/implementation/2026-09-26-landing-rebuild/
// 01-product-and-balance.md；本文件数值是 P 探针验证后的实现基线，修改须回 P 握手。
// 与旧 release 的关键差异：设施以套件运抵、由玩家安装投产；新机器人小电池 + 每分钟
// workDrainWhPerTick；配方按 ratedW/workMinutesPerBatch 消耗 W·min 能量；资源节点有限；
// credits 显式 0、无订单模板（无 external_trade 能力）。
import type {
  ContentBaseRelease,
  ContentFacilityInfo,
  ContentItemInfo,
  ContentProjectTemplate,
  ContentProvisionSeed,
  ContentRecipeTemplate,
  ContentRobotTemplate
} from "./schemas.js";

export const LANDING_BASE_RELEASE_ID = "yudian-landing-1";

// ---------- 机器人模板（landing-hauler/builder/surveyor @1，新 stableId 防旧实例误读新规则） ----------
// 电池容量 / 初始电量（60%）：驮运 120/72、筑垒 180/108、望山 80/48。
// 出工每基地分钟耗电：驮运 3Wh、筑垒 6Wh、望山 2Wh（不沿用旧 500Wh 阈值）。
export const LANDING_ROBOT_TEMPLATES: ContentRobotTemplate[] = [
  {
    ref: { kind: "robot_template", stableId: "landing-hauler", revision: 1 },
    name: "驮运",
    groupId: "transport",
    description: "随船运抵的驮运机器人，负责把采出的矿石送回仓库。",
    batteryCapacityWh: 120,
    chargeRateW: 360,
    workRatePerTick: 1,
    workDrainWhPerTick: 3
  },
  {
    ref: { kind: "robot_template", stableId: "landing-builder", revision: 1 },
    name: "筑垒",
    groupId: "engineering",
    description: "随船运抵的工程机器人，自带基础采掘附件，可在施工与采矿之间选择。",
    batteryCapacityWh: 180,
    chargeRateW: 600,
    workRatePerTick: 1,
    workDrainWhPerTick: 6
  },
  {
    ref: { kind: "robot_template", stableId: "landing-surveyor", revision: 1 },
    name: "望山",
    groupId: "survey",
    description: "随船运抵的勘测机器人，负责勘探矿点和工程验收。",
    batteryCapacityWh: 80,
    chargeRateW: 240,
    workRatePerTick: 1,
    workDrainWhPerTick: 2
  }
];

// ---------- 六种套件安装 + 三种扩建模板 ----------
// 首次安装：单 installation 工序 2 工作点（默认 2 台筑垒 = 1 基地分钟）。
// 扩建：安装 4 点 + 验收 2 点。初始套件每种只允许一处（一次建成语义）；
// 扩建模板共享四个扩建位配额（expansionSlot 标记）。
export const LANDING_PROJECT_TEMPLATES: ContentProjectTemplate[] = [
  {
    ref: { kind: "project", stableId: "landing-install-solar", revision: 1 },
    name: "安装首座太阳能",
    description: "在选定位置安装运抵的太阳能套件并并网，完成后基地峰值供电 +4 kW。",
    steps: [{ kind: "installation", groupId: "engineering", workRequired: 2 }],
    inputs: [{ itemId: "solar_kit", quantity: 1 }],
    outputFacility: {
      ref: { kind: "facility", stableId: "landing-solar", revision: 1 },
      name: "太阳能电站",
      generationWPeak: 4000
    },
    allowedSiteKeys: ["install_solar"],
  },
  {
    ref: { kind: "project", stableId: "landing-install-warehouse", revision: 1 },
    name: "安装仓储棚",
    description: "架设仓储棚，解锁矿石入库与本地加工；先建成太阳能再施工。",
    steps: [{ kind: "installation", groupId: "engineering", workRequired: 2 }],
    inputs: [{ itemId: "warehouse_kit", quantity: 1 }],
    outputFacility: {
      ref: { kind: "facility", stableId: "landing-warehouse", revision: 1 },
      name: "仓储棚",
      effects: { capabilities: ["warehouse"] }
    },
    requiresFacilities: ["landing-solar"],
    allowedSiteKeys: ["install_warehouse"]
  },
  {
    ref: { kind: "project", stableId: "landing-install-storage", revision: 1 },
    name: "安装储能间",
    description: "安装储能间，储电容量 +5 kWh（新增容量为空，需要真实充电）；先建成太阳能再施工。",
    steps: [{ kind: "installation", groupId: "engineering", workRequired: 2 }],
    inputs: [{ itemId: "storage_kit", quantity: 1 }],
    outputFacility: {
      ref: { kind: "facility", stableId: "landing-storage", revision: 1 },
      name: "储能间",
      effects: { storageCapacityWh: 5000 }
    },
    requiresFacilities: ["landing-solar"],
    allowedSiteKeys: ["install_storage"]
  },
  {
    ref: { kind: "project", stableId: "landing-install-charging", revision: 1 },
    name: "安装充电区",
    description: "安装充电区，全基地充电上限从 400 W 增至 2000 W；先建成太阳能再施工。",
    steps: [{ kind: "installation", groupId: "engineering", workRequired: 2 }],
    inputs: [{ itemId: "charging_kit", quantity: 1 }],
    outputFacility: {
      ref: { kind: "facility", stableId: "landing-charging", revision: 1 },
      name: "充电区",
      effects: { chargeLimitW: 1600 }
    },
    requiresFacilities: ["landing-solar"],
    allowedSiteKeys: ["install_charging"]
  },
  {
    ref: { kind: "project", stableId: "landing-install-processing", revision: 1 },
    name: "安装加工间",
    description: "安装加工间，提供一条加工槽（额定 2 kW/槽）；先建成仓储棚再施工。",
    steps: [{ kind: "installation", groupId: "engineering", workRequired: 2 }],
    inputs: [{ itemId: "processing_kit", quantity: 1 }],
    outputFacility: {
      ref: { kind: "facility", stableId: "landing-processing", revision: 1 },
      name: "加工间",
      effects: { processingSlots: 1, capabilities: ["processing"] }
    },
    requiresFacilities: ["landing-warehouse"],
    allowedSiteKeys: ["install_processing"]
  },
  {
    ref: { kind: "project", stableId: "landing-install-maintenance", revision: 1 },
    name: "安装维护工位",
    description: "安装维护工位，可对加工槽做消耗备件的维护；先建成仓储棚再施工。",
    steps: [{ kind: "installation", groupId: "engineering", workRequired: 2 }],
    inputs: [{ itemId: "maintenance_kit", quantity: 1 }],
    outputFacility: {
      ref: { kind: "facility", stableId: "landing-maintenance", revision: 1 },
      name: "维护工位",
      effects: { capabilities: ["maintenance"] }
    },
    requiresFacilities: ["landing-warehouse"],
    allowedSiteKeys: ["install_maintenance"]
  },
  {
    ref: { kind: "project", stableId: "landing-expand-solar", revision: 1 },
    name: "增建太阳能",
    description: "用自产结构件与线缆扩建一座太阳能电站，峰值供电再 +4 kW。",
    steps: [
      { kind: "installation", groupId: "engineering", workRequired: 4 },
      { kind: "commissioning", groupId: "survey", workRequired: 2 }
    ],
    inputs: [
      { itemId: "structural_frame", quantity: 4 },
      { itemId: "wire_cable", quantity: 2 },
      { itemId: "pv_cell", quantity: 6 }
    ],
    outputFacility: {
      ref: { kind: "facility", stableId: "landing-solar", revision: 1 },
      name: "太阳能电站",
      generationWPeak: 4000
    },
    expansionSlot: true,
    allowedSiteKeys: ["expand_a", "expand_b", "expand_c", "expand_d"],
  },
  {
    ref: { kind: "project", stableId: "landing-expand-processing", revision: 1 },
    name: "增建加工间",
    description: "扩建一条加工槽，产能翻倍，但真实用电随之上升。",
    steps: [
      { kind: "installation", groupId: "engineering", workRequired: 4 },
      { kind: "commissioning", groupId: "survey", workRequired: 2 }
    ],
    inputs: [
      { itemId: "structural_frame", quantity: 6 },
      { itemId: "wire_cable", quantity: 2 },
      { itemId: "controller", quantity: 1 }
    ],
    outputFacility: {
      ref: { kind: "facility", stableId: "landing-processing", revision: 1 },
      name: "加工间",
      effects: { processingSlots: 1, capabilities: ["processing"] }
    },
    expansionSlot: true,
    allowedSiteKeys: ["expand_a", "expand_b", "expand_c", "expand_d"],
  },
  {
    ref: { kind: "project", stableId: "landing-expand-storage", revision: 1 },
    name: "增建储能",
    description: "扩建 5 kWh 空储电容量用于储备夜间生产，不提高瞬时发电。",
    steps: [
      { kind: "installation", groupId: "engineering", workRequired: 4 },
      { kind: "commissioning", groupId: "survey", workRequired: 2 }
    ],
    inputs: [
      { itemId: "structural_frame", quantity: 4 },
      { itemId: "wire_cable", quantity: 2 },
      { itemId: "controller", quantity: 1 }
    ],
    outputFacility: {
      ref: { kind: "facility", stableId: "landing-storage", revision: 1 },
      name: "储能间",
      effects: { storageCapacityWh: 5000 }
    },
    expansionSlot: true,
    allowedSiteKeys: ["expand_a", "expand_b", "expand_c", "expand_d"]
  }
];

// ---------- 开局种子 ----------
// 着陆器（built）：应急发电 1000W + 基础负载 200W + 储电 1000/2000Wh + 充电上限 400W；
// 太阳能峰值 0（首座由玩家安装）；新档 credits 显式 0；不预派矿工/施工。
// 六个套件安装位 + 四个扩建位均为 free。
export const LANDING_PROVISION_SEED: ContentProvisionSeed = {
  releaseId: LANDING_BASE_RELEASE_ID,
  baseName: "着陆场",
  power: {
    generationWPeak: 0,
    storageCapacityWh: 2000,
    initialStorageWh: 1000,
    emergencyGenerationW: 1000,
    baseLoadW: 200,
    chargeLimitW: 400,
    initialDustLevel: 0
  },
  sites: [
    {
      siteKey: "lander",
      name: "着陆器",
      state: "built",
      facilityRef: { kind: "facility", stableId: "landing-lander", revision: 1 }
    },
    { siteKey: "install_solar", name: "太阳能安装位", state: "free" },
    { siteKey: "install_warehouse", name: "仓储棚安装位", state: "free" },
    { siteKey: "install_storage", name: "储能间安装位", state: "free" },
    { siteKey: "install_charging", name: "充电区安装位", state: "free" },
    { siteKey: "install_processing", name: "加工间安装位", state: "free" },
    { siteKey: "install_maintenance", name: "维护工位安装位", state: "free" },
    { siteKey: "expand_a", name: "扩建位 A", state: "free" },
    { siteKey: "expand_b", name: "扩建位 B", state: "free" },
    { siteKey: "expand_c", name: "扩建位 C", state: "free" },
    { siteKey: "expand_d", name: "扩建位 D", state: "free" }
  ],
  inventory: [
    { itemId: "solar_kit", quantity: 1 },
    { itemId: "warehouse_kit", quantity: 1 },
    { itemId: "storage_kit", quantity: 1 },
    { itemId: "charging_kit", quantity: 1 },
    { itemId: "processing_kit", quantity: 1 },
    { itemId: "maintenance_kit", quantity: 1 },
    { itemId: "controller", quantity: 12 },
    { itemId: "pv_cell", quantity: 12 },
    { itemId: "spare_part", quantity: 6 }
  ],
  devices: [
    { templateStableId: "landing-hauler", groupId: "transport", count: 4, initialBatteryWh: 72 },
    { templateStableId: "landing-builder", groupId: "engineering", count: 5, initialBatteryWh: 108 },
    { templateStableId: "landing-surveyor", groupId: "survey", count: 3, initialBatteryWh: 48 }
  ],
  initialCredits: 0,
  resourceNodes: [
    { nodeKey: "iron_north", name: "北坡磁异常", itemId: "iron_ore", initialQuantity: 200 },
    { nodeKey: "copper_ridge", name: "脊线蓝绿氧化带", itemId: "copper_ore", initialQuantity: 200 }
  ]
};

export const LANDING_ITEM_INFO: Record<string, ContentItemInfo> = {
  solar_kit: {
    name: "太阳能套件",
    description: "随船运抵的折叠太阳能电站组件，安装并网后 +4 kW 峰值供电。"
  },
  warehouse_kit: {
    name: "仓储套件",
    description: "仓储棚结构件，建成后矿石才能入库、加工才能开工。"
  },
  storage_kit: {
    name: "储能套件",
    description: "储能间组件，建成后储电容量 +5 kWh（新增容量为空）。"
  },
  charging_kit: {
    name: "充电区套件",
    description: "充电桩区组件，建成后全基地充电上限从 400 W 提到 2000 W。"
  },
  processing_kit: {
    name: "加工间套件",
    description: "加工设备组件，建成后提供一条加工槽（每槽额定 2 kW）。"
  },
  maintenance_kit: {
    name: "维护工位套件",
    description: "维护设备组件，建成后可对加工槽做消耗备件的维护。"
  },
  controller: {
    name: "电子控制器",
    description: "随船高级部件，数量有限，用于增建加工间/储能和组装驮运。"
  },
  pv_cell: {
    name: "光伏片",
    description: "随船高级部件，数量有限，用于增建太阳能。"
  },
  spare_part: {
    name: "备件",
    description: "维护加工槽的耗材；初始 6 件，之后可由本地冶炼制造。"
  },
  iron_ore: {
    name: "铁矿",
    description: "从北坡磁异常采出的铁矿石，冶炼成铁料。"
  },
  copper_ore: {
    name: "铜矿",
    description: "从脊线氧化带采出的铜矿石，冶炼成铜料。"
  },
  iron_ingot: {
    name: "铁料",
    description: "冶炼铁料：进一步加工成结构件或备件。"
  },
  copper_ingot: {
    name: "铜料",
    description: "冶炼铜料：拉制线缆或与铁料合成备件。"
  },
  structural_frame: {
    name: "结构件",
    description: "加工结构件：扩建工程的主要材料。"
  },
  wire_cable: {
    name: "线缆",
    description: "拉制的输电线缆：扩建与设备组装都要用。"
  }
};

// ---------- 配方（landing：额定 2000W；组装驮运 3 分钟/台） ----------
// 冶炼：2 矿 → 1 料；结构件 2 铁料 → 1；线缆 1 铜料 → 2；备件 1铁+1铜 → 2；
// 组装驮运 4结构件+2线缆+1控制器+2备件 → 驮运 1 台（初始电 0，需真实充电）。
// 手工备件在着陆器运行（200W、4 分钟/件、不计维护）——维护软锁的公开恢复路径。
export const LANDING_RECIPE_TEMPLATES: ContentRecipeTemplate[] = [
  {
    ref: { kind: "recipe", stableId: "landing-smelt-iron", revision: 1 },
    name: "冶炼铁料",
    description: "把 2 铁矿熔炼成 1 铁料。",
    inputs: [{ itemId: "iron_ore", quantity: 2 }],
    workPerUnit: 1,
    output: { kind: "item", itemId: "iron_ingot", quantity: 1 },
    ratedW: 2000,
    workMinutesPerBatch: 1,
    requiredCapability: "processing"
  },
  {
    ref: { kind: "recipe", stableId: "landing-smelt-copper", revision: 1 },
    name: "冶炼铜料",
    description: "把 2 铜矿熔炼成 1 铜料。",
    inputs: [{ itemId: "copper_ore", quantity: 2 }],
    workPerUnit: 1,
    output: { kind: "item", itemId: "copper_ingot", quantity: 1 },
    ratedW: 2000,
    workMinutesPerBatch: 1,
    requiredCapability: "processing"
  },
  {
    ref: { kind: "recipe", stableId: "landing-make-structural", revision: 1 },
    name: "加工结构件",
    description: "把 2 铁料轧成 1 结构件。",
    inputs: [{ itemId: "iron_ingot", quantity: 2 }],
    workPerUnit: 1,
    output: { kind: "item", itemId: "structural_frame", quantity: 1 },
    ratedW: 2000,
    workMinutesPerBatch: 1,
    requiredCapability: "processing"
  },
  {
    ref: { kind: "recipe", stableId: "landing-make-cable", revision: 1 },
    name: "制造线缆",
    description: "把 1 铜料拉制成 2 线缆。",
    inputs: [{ itemId: "copper_ingot", quantity: 1 }],
    workPerUnit: 1,
    output: { kind: "item", itemId: "wire_cable", quantity: 2 },
    ratedW: 2000,
    workMinutesPerBatch: 1,
    requiredCapability: "processing"
  },
  {
    ref: { kind: "recipe", stableId: "landing-make-spares", revision: 1 },
    name: "制造备件",
    description: "用 1 铁料和 1 铜料造 2 备件。",
    inputs: [
      { itemId: "iron_ingot", quantity: 1 },
      { itemId: "copper_ingot", quantity: 1 }
    ],
    workPerUnit: 1,
    output: { kind: "item", itemId: "spare_part", quantity: 2 },
    ratedW: 2000,
    workMinutesPerBatch: 1,
    requiredCapability: "processing"
  },
  {
    ref: { kind: "recipe", stableId: "landing-assemble-hauler", revision: 1 },
    name: "组装驮运",
    description: "用 4 结构件、2 线缆、1 控制器和 2 备件组装一台驮运（出厂电量 0，需充电后使用）。",
    inputs: [
      { itemId: "structural_frame", quantity: 4 },
      { itemId: "wire_cable", quantity: 2 },
      { itemId: "controller", quantity: 1 },
      { itemId: "spare_part", quantity: 2 }
    ],
    workPerUnit: 3,
    output: { templateStableId: "landing-hauler", initialBatteryWh: 0 },
    ratedW: 2000,
    workMinutesPerBatch: 3,
    requiredCapability: "processing"
  },
  {
    ref: { kind: "recipe", stableId: "landing-handcraft-spares", revision: 1 },
    name: "手工备件",
    description: "在着陆器用 2 铁矿和 2 铜矿手工拼装 1 备件：耗时长、功率低，是维护停机且无备件时的恢复路径。",
    inputs: [
      { itemId: "iron_ore", quantity: 2 },
      { itemId: "copper_ore", quantity: 2 }
    ],
    workPerUnit: 4,
    output: { kind: "item", itemId: "spare_part", quantity: 1 },
    ratedW: 200,
    workMinutesPerBatch: 4,
    requiredCapability: "lander_manual",
    countsSlotMaintenance: false
  }
];

// 着陆器设施说明（地图卡片静态信息；运行能力在规则侧）。
export const LANDING_FACILITY_INFO: Record<string, ContentFacilityInfo> = {
  "landing-lander": {
    name: "着陆器",
    note: "应急供电与手工恢复",
    description:
      "运抵设备与套件的着陆器：应急发电 1 kW 持续供电（基础负载 200 W、充电上限 400 W），并为手工备件提供工位。它不是永久工厂，不授予仓库、加工或正式维护能力。",
    attributes: [
      { label: "应急发电", value: "1.0 kW（不受日照影响）" },
      { label: "随船储电", value: "1.0 / 2.0 kWh" },
      { label: "充电上限", value: "400 W（建充电区后 2 kW）" }
    ]
  },
  "landing-solar": {
    name: "太阳能电站",
    note: "昼间为基地供电",
    description: "安装并网的太阳能电站，昼间按日照与积尘系数出力。",
    attributes: [
      { label: "峰值发电", value: "4.0 kW" },
      { label: "供电时段", value: "昼间（基地时间 06:00–18:00）" }
    ]
  },
  "landing-warehouse": {
    name: "仓储棚",
    note: "矿石入库与加工前置",
    description: "仓储棚建成前采出的矿石无法入库；它同时是加工间与维护工位的前置。",
    attributes: [{ label: "解锁", value: "矿石入库、本地加工" }]
  },
  "landing-storage": {
    name: "储能间",
    note: "扩大储电容量",
    description: "储能间只增加容量：新增的 5 kWh 是空的，需要真实发电充入。",
    attributes: [{ label: "容量增量", value: "+5.0 kWh（初始为空）" }]
  },
  "landing-charging": {
    name: "充电区",
    note: "提高充电上限",
    description: "充电桩区把全基地充电总上限从 400 W 提到 2000 W，不发电。",
    attributes: [{ label: "充电上限", value: "400 W → 2.0 kW" }]
  },
  "landing-processing": {
    name: "加工间",
    note: "冶炼与材料制造",
    description: "加工间提供加工槽（每槽额定 2 kW），完成 10 批后需要维护才能继续。",
    attributes: [
      { label: "加工槽", value: "1 条（可扩建）" },
      { label: "额定负载", value: "2.0 kW / 槽" },
      { label: "维护", value: "每 10 批消耗 1 备件" }
    ]
  },
  "landing-maintenance": {
    name: "维护工位",
    note: "维护加工槽",
    description: "对加工槽做消耗备件的维护，恢复其继续生产的能力。",
    attributes: [
      { label: "消耗", value: "备件 1 件 / 次" },
      { label: "维护窗口", value: "第 8–10 批起可提前维护" }
    ]
  }
};

export const LANDING_BASE_CONTENT_RELEASE: ContentBaseRelease = {
  releaseId: LANDING_BASE_RELEASE_ID,
  itemNames: LANDING_ITEM_INFO,
  robots: LANDING_ROBOT_TEMPLATES,
  projects: LANDING_PROJECT_TEMPLATES,
  recipes: LANDING_RECIPE_TEMPLATES,
  orderTemplates: [],
  provisionSeed: LANDING_PROVISION_SEED,
  rulesProfile: "landing-v1",
  capabilities: [],
  facilityInfo: LANDING_FACILITY_INFO
};
