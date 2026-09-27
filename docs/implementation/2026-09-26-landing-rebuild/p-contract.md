# R1 P 合同（实施后冻结记录）

实施分支：codex/landing-r1-glm53。字段/单位/端口以本文件与源码为准；数值合同见
01-product-and-balance.md，本文件记录实现口径与偏差。

## 1. 单位与精度

- 功率 W、电量 Wh 整数；站内能量一律 W·min（=1/60 Wh）整数定点。
  `base_power_state.storage_wh`（整 Wh）+ `storage_excess_wm`（0–59 余数）合成精确存量；
  发电端小数（光照/积尘系数）经 `gen_remainder_wm` 结转，不丢能量。
- 机器人电池整 Wh；充电按整 Wh 入电池，舍入剩余留回站内池。出工每基地分钟耗
  `workDrainWhPerTick`（驮运 3 / 筑垒 6 / 望山 2；缺省=旧 500 常量，旧档不受影响）。

## 2. Schema / 迁移（0038_landing_rebuild，journal idx 37）

新表 `base_resource_nodes`、`base_extraction_jobs`（active/paused/stopping/completed/cancelled；
每节点一条活动单部分唯一索引；kind×phase/operator 形状 CHECK）、`base_extraction_outputs`
（job+ordinal 唯一；extracted/delivered）、`base_production_slots`（base+site+slot 唯一；计数 0–10）。
`robot_operators.current_extraction_job_id`（与 current_project_id 互斥 CHECK）。
`base_manufacturing_jobs` += production_site_id/energy_wm_per_batch/current_batch_energy_wm
（旧单 NULL=旧语义）；outputs += output_kind('robot'|'item')/item_id/quantity，device/operator
改 nullable + 形状 CHECK。`base_power_state` += emergency_generation_w/charge_limit_w/
power_policy/storage_excess_wm/gen_remainder_wm。旧迁移未改。

## 3. 命令面（REST，均带会话+CSRF+账号→基地校验+commandId）

- 复用 POST /base/projects（landing 模板带 requiresFacilities/expansionSlot 校验：套件一次建成、
  扩建共享 4 位配额）
- POST /base/resource-nodes/:nodeId/survey {operatorId}
- POST /base/extraction-jobs {nodeId,batches 1–10,builders 1–2,hauler}；/:id/pause|resume|cancel
- POST /base/manufacturing（landing 路径：自动绑最早可用槽；手工配方绑着陆器且并发 1）；
  /base/manufacturing/:jobId/pause|resume（暂停释放槽位、材料预留保留）
- POST /base/production-slots/:siteId/maintain（第 8–10 批窗口；消耗 1 备件）
- POST /base/power-policy {production|charging}
- 新命令可选 expectedBaseRevision：不匹配 → REVISION_EXPIRED（客户端刷新一次重试）

## 4. 结算语义（landing-v1）

- BaseSettlementService 按 catalog.rulesProfile 分流到 landing-settlement（每基地分钟一次
  computeLandingMinute；读端口绑定结算事务——曾因绑根 db 出现多分钟单事务陈旧读，已修复并有
  G09 分片等价回归）。
- 顺序：发电（应急+昼间太阳能×光照×(1−尘/200)）→ 基础 200 → 施工现场 200 → 工序
  （机器人自身电池）→ 加工/充电按策略比例分摊 → 盈余入储能。
- 采矿相位串行：一分钟只推一个工序（mining 2 筑垒点 → 采出现场货物 → hauling 1 驮运点 →
  送达入库）；stopping 送完已采量即 cancelled。
- 加工槽：每分钟每槽至多 ratedW W·min；第 10 批完成即停机，维护（消耗 1 备件）清零；
  组装机器人出厂 0 Wh。

## 5. 能力位与经济门

release.capabilities 缺省 ["external_trade"]；yudian-landing-1 = []。订单生成/接单/交付/采购
在后端检查该位（新档 409 CAPABILITY_UNAVAILABLE），不靠 UI 隐藏。快照透出 capabilities。

## 6. 记录的偏差（均属实现口径选择，未改产品目标）

1. 单槽同时只绑一单：新单需等当前单完成或暂停（暂停释放槽位）；不做服务端排队。
   "FIFO"体现在多槽站点按创建序分槽。
2. 基础负载 200W 为 release 规则参数（内容 seed），不落库列。
3. 天气：landing 不生成天气日程，WeatherService 缺省返回晴/1.0（R1 无尘暴事件）。
4. 教程 e2e 改为 runner 预置 legacy 基地后登录回归（默认注册已是 landing-1）。
5. 手工备件配方经着陆器站点绑定（production_site_id=lander），并发 1，同槽位模型。

## 7. 文件归属（实际）

P/I：packages/shared（base/errors/content-admin/version）、packages/content schemas、
db/schema+0038、application/base（ports/composition/provision 目录注入点）、app.ts。
A：industry/landing-rules、facility-effects、base-settlement 分流。B：extraction.*、
production-slot.*、manufacturing landing 面、base-extraction/base-production 路由（transport 层）。
C：packages/content landing-release。D：apps/web LandingShell/baseApi/BaseApp 分支。
Q：tests/base-operations/landing/*、apps/web/e2e/landing-real.spec.ts。全部登记
docs/architecture/module-boundaries.json（arch:check PASS）。
