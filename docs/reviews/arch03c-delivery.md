# ARCH-03c 交付记录：NPC 自身流与角色流迁入统一资产入口（ARCH-03 收官）

- 分支：`arch/v0.11.0-arch03c-flows`（基于 main 67294aa）；日期 2026-09-18
- 执行方式：双子代理并行实现（npc 流 / 角色流，文件所有权隔离）+ 主代理集成验收；期间一次脚本切损由原代理自主修复
- 规则数值零改动；版本保持 0.10.6

## 变更

1. **NPC 自身资金流**（买食物/卖余粮/工资）：铜币、金库、市场库存的可变写入全部改经 `AssetMutationService`（经 NpcService 新增的第三参 assets 端口注入，世界 tick 参与方与仿真编排分别绑定同一事务句柄）。工资"国库不足发部分"语义保留（条件扣减竞败返回零支付）。`NpcRepositoryPort` 与 npc 仓储/仿真仓储删除 6 个资金方法 + 2 个孤儿方法（`setMarketInventoryQuantity/updateMunicipalTreasury`，零调用方）；`updateNpcActor` 入参移除 copperBalance 字段。
2. **角色侧**：修理扣款、救济储备扣减改经 assets（救济新增 `debitMarketStockAboveReserve`——带市场保底量的库存扣减）；救济冷却时间戳更新留在仓储（仅写 last_relief_claimed_at，条件竞争保护等价保留）。
3. **种子路径**：`upsertMarketInventory` 改为只插入、冲突跳过（消除对已存在行数量的改写；INSERT 建行默认值属合同允许的例外类别）。

## 台账

- **DEBT-016/017/018/019 销账**（铜币两列、市场库存数量、金库的可变余额写入现仅存在于 AssetMutationService）。
- **DEBT-020 保留**（npc_items 数量仍在 npc 仓储），与 ItemService 统一切片（ARCH-04 邻接）一并处理。
- 模块边界登记：无新增生产文件；测试桩随既有 DEBT-034/040/041/042 登记。

## 验收（全部实跑）

- `pnpm --filter @ai-mud/server typecheck` 0 错误；`CI=true pnpm -r test` 全绿（server 359+6、web 103、其余包全过）；
- `pnpm -r build` PASS；`pnpm db:verify-migrations` PASS；
- `pnpm test:postgres` 15/15（含 ARCH-02 锁证据与 ARCH-03a 故障注入证据保持）；
- `pnpm verify:npc-simulation`：ok:true、闲置率 0、零饿死、账本前后核对 ok（仿真编排经新 assets 端口运行）；
- `pnpm arch:check` PASS（两次报告逐字节一致）；`pnpm arch:test` 12/12。

## 已知保留

- DEBT-020（npc_items 数量经 npc 仓储）——ItemService 统一后销账；
- DEBT-025（共享资源节点写入归 world）——按台账保留，随 world 参与方 API 深化处理；
- 工资并发竞败分支（多副本同时发薪时返回零支付而非重试）——单进程语义不变，已如实记录，多副本容量声明仍被合同禁止。
