# M13-P：v0.13.0 接口包冻结

状态：CONTRACT_READY（M13-P 冻结；基线 = 分支 v0.12.0-base-operations 794e4e6 + 本包提交）。

## 1. 范围裁决

- **BOUNDARY-01（目录化范围）**：v0.13 目录化 `robot_template` / `project` / **`recipe`（新增）** 三类定义。物品（itemId）与设施（facility）**维持静态代码**，推迟目录化——制造/项目 inputs 引用静态 itemId 不变。此为 P 按实际落地做的收缩，spec 中"后台维护资源/物品"的物品部分转后续版本。
- **BOUNDARY-02（制造与项目的关系）**：制造工单不复用 base_projects/base_project_steps（步骤链语义不符），新建 `base_manufacturing_jobs` + `base_manufacturing_outputs`，但**复用 assets 预留/消耗端口与基地 tick 结算框架**（同事务、同电力池）。

## 2. 数据契约（schema.ts + drizzle/0030_content_manufacturing.sql）

| 表 | 写者 | 说明 |
|---|---|---|
| content_drafts | content-catalog | kind(3类)/stable_id/revision/payload；draft 期间可改 |
| content_releases | content-catalog | release_id unique / payload 整包 / content_hash / definition_count / published_by |
| base_manufacturing_jobs | industry | recipe_def_id+revision / status / outputs_planned(1..20) / outputs_done / current_unit_work_done / reserved_inputs |
| base_manufacturing_outputs | industry | (job_id, ordinal) 唯一 / device_id / operator_id —— 设备↔作业者 1:1 与 provision 同规则 |

激活 = 更新 `bases.content_release`（写者 content-catalog 经用例）+ audit log。不建激活表。

## 3. 公开接口（形状冻结）

**玩家（制造）**：
- `POST /base/manufacturing` `{recipeRef, outputsPlanned(1..20), commandId?}` → `{jobId, duplicate}`——回据 `actorScope=base:{id}, kind=base.createManufacturingJob`；同事务全额预留 inputs（任一不足→RESOURCE_INSUFFICIENT 整体回滚）
- `POST /base/manufacturing/:jobId/cancel` `{commandId?}` → `{cancelled, duplicate, releasedInputs}`——回据 `base.cancelManufacturingJob`
- `GET /base/snapshot` 扩展：`manufacturingJobs: ManufacturingJobDto[]`

**管理员（内容）**：全部要求 admin 角色（现有 getCurrentAdmin 骨架）：
- `GET /admin/content/drafts` / `POST /admin/content/drafts` / `PUT /admin/content/drafts/:draftId` / `DELETE /admin/content/drafts/:draftId`
- `POST /admin/content/publish` → 整包（内置 release + 全部 draft 合并）校验 → hash → 写 content_releases → `{releaseId, definitionCount, contentHash}`；校验失败 400 CONTENT_INCOMPATIBLE 且零写入
- `GET /admin/content/releases`
- `POST /admin/content/activate` `{releaseId, baseId}` → 校验 base 存在 → 更新 bases.content_release + audit

**CatalogPort 扩展**：`getRecipeTemplate(stableId)` / `listRecipes()`；目录解析顺序：base.content_release → content_releases 表 → 找不到该 id 则回退内置 release（回退行为在 P 合同声明为显式 fallback，不是静默升位）。

## 4. 制造结算语义（industry，冻结）

每基地 tick（同 world tick 参与者，项目结算之后）：
1. 读 active 制造工单（FIFO 按 created_at）
2. 电力分配优先级：基础负荷 < 施工 < **制造** < 充电；制造负载固定 1500W（fixture）
3. 每工单本 tick 工作量 = min(可分配电力份额, 1 tick 生产能力)；按 Δh 折算 → `current_unit_work_done += work`
4. `current_unit_work_done >= workPerUnit` → **单台产出原子事务**：确认材料预留（该台 inputs 份额从 reserved_inputs 扣）→ createDeviceAsset（sourceOperation=`job:{jobId}:{ordinal}`）→ initializeOperator → 写 outputs(jobId, ordinal) → outputs_done++ / current_unit_work_done 清零重计
5. outputs_done == outputs_planned → 工单 completed
6. 储能耗尽 → 工单 blocked 'insufficient_power'（工作量不动，复用项目同语义）
7. 中途事件（完工/耗尽）分段结算，同 v0.12 子 tick 规则

## 5. fixture（游戏初值）

- recipe `manufacture-yd-h1`：inputs support_frame×4 + spare_parts×6 + power_box×1；workPerUnit 30；产出 yd-h1（initialBatteryWh 12000）
- recipe `manufacture-yd-s1`：inputs spare_parts×4 + anchor×3；workPerUnit 20；产出 yd-s1（6000）
- 制造负载 1500W；批量上限 20 台/单

## 6. 文件归属（boundaries 已登记）

| 线 | 新文件 |
|---|---|
| A（发布服务） | content-catalog/content-admin.service.ts、content-admin.repository.ts、content-catalog/catalog-db.loader.ts；application/content-admin/usecases.ts |
| B（管理 UI） | web features/admin/ContentAdminPanel.tsx（+css/test）；admin/content-admin.routes.ts（transport） |
| C（制造） | industry/manufacturing.service.ts、manufacturing.repository.ts、manufacturing.settlement.ts；application/manufacturing/create-job.ts、cancel-job.ts；industry/base-manufacturing.routes.ts（transport） |
| D（玩家 UI/成品接入） | web features/base/ManufacturingBoard.tsx（+test）；shared 已含 DTO；成品自动入队（robot-factory 复用，无新文件） |
| Q | tests/base-operations/m13/ |
| I/P（共享） | shared/content-admin.ts、schema.ts+0030、composition、catalog.service 扩展、boundaries |

routes 一律 deps 必填（无默认依赖），transport 只 import application。管理员身份经现有 admin 会话骨架校验。

## 7. 验收对照（M13-G01—G09 的实现锚点）

G01 新型号零代码→发布→制造（A+C+D 全链）；G02 非法引用/坏单位→发布 400 且旧 release 不变；G03 三台三实例+重复 ordinal 幂等（真 PG）；G04 产出中途故障零部分提交（真 PG 故障注入）；G05 缺电暂停/取消释放；G06 在途工单持旧修订；G07 停用/回退不抹产物（release 不可变，回退=激活旧 release）；G08 普通账号无发布权（403）；G09 新机器人自动入队干活（robot_operators 状态 idle 可被调度）。

## 8. mock/集成规则

同 v0.12：A/B/C/D 文件白名单互斥；跨线走端口结构镜像；mock 可用于开发，最终通过必须在真链；Q 真库验收。
