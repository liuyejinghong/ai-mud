# ARCH-03b 交付记录：任务链与 NPC 赠予迁入统一资产入口

- 任务：v0.11.0 / ARCH-03（续）——迁移顺序"任务托管/完成/退还 → NPC 赠予"
- 分支：`arch/v0.11.0-arch03b-task-gift`（基于 main 8c096bb）
- 日期：2026-09-18。规则数值零改动；版本保持 0.10.6。

## 变更

1. **任务托管/完成/退还**：`NpcTaskService` 的托管扣款（reserveNpcCopper，保留 5 铜保护）、任务奖励入账、过期退还全部改经 `AssetMutationService`；任务报酬记账经 `LedgerService`；交付物品转移经 `ItemService.transfer`（characters→npc）。以上均在任务用例的同一事务内（事务回调同时交出仓储与句柄）。`quests→assets` 为 catalog 允许边——服务层直连合法，仓储层不再越界。
2. **NpcTaskRepository 瘦身**：删除 `reserveNpcCopper/incrementNpcCopper/incrementCharacterCopper/recordCopperTransfer/transferCharacterItemToNpc` 五个资金/物品方法与 item/ledger 导入；仓储只保留任务状态与读取。**DEBT-002/003 销账**。
3. **NPC 赠予**：`dialogue-resource-transfer.repository` 的铜币直写（world_actors/characters 列）改经 `AssetMutationService`；账本不变。
4. 端口签名：`transaction(operation(repo, tx))`——任务用例经 composition 注入的 `NpcTaskAssetPorts`（assetsFor/ledgerFor/itemsFor）获得绑定同一事务的资产能力；platform 无反向依赖，composition 负责绑定。

## 台账

- 销账：DEBT-002、DEBT-003（removalCondition 达成）。
- 登记：DEBT-042（任务服务测试的 assets 桩与 ItemService 导入，transitional）。
- 缩窄：DEBT-016/017 的对话/任务侧写路径消失，残余为 game 修理（03c）与 npc 自身流（ARCH-03c/后续）；DEBT-020（npc_items 数量）保持——物品数量统一随 03c/ARCH-04 处理。

## 验收

- `pnpm --filter @ai-mud/server typecheck` 0 错误；`CI=true pnpm -r test` 全绿（server 39 文件 359 例 + 6 跳过，web 103，其余包全过）；
- `pnpm test:postgres` 15/15（含 ARCH-02 的锁证据与 ARCH-03a 的故障注入）；
- `pnpm arch:check` PASS、两次报告逐字节一致；`pnpm arch:test` 12/12；`pnpm -r build` PASS。
- NOT_RUN：无（本切片未涉及模型/浏览器）。

## 未做

- NPC 自身买卖/工资/吃饭（npc.service 内部）与角色吃饭/修理/救济：ARCH-03 顺序中的后续切片（03c），届时 DEBT-016/017/020 全部销账；
- 任务流命令回执：沿用条件状态更新（accepted→completed）作为幂等闸门（合同允许的"稳定标识去重"），未叠加 receipt 表。
