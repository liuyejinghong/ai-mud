# ARCH-04 交付记录：装备单一真源（双表示终结）

- 分支：`arch/v0.11.0-arch04-equipment`（基于 main 96db7cc）；日期 2026-09-18
- 规则数值零改动；版本保持 0.10.6

## 变更

1. **迁移 0027**：`character_equipment` 全部行迁入 `item_instances`（locationType=equipped、ownerType=character、沿用原 UUID、base_stats={attack,defense,agility:0,maxHp:0}、耐久与等级原值），`ON CONFLICT (id) DO NOTHING` 保证幂等且绝不覆盖已存在实例；随后删除 `character_equipment` 表。
2. **代码切换**：新角色初始装备直接创建 equipped 实例（固定数值，不经随机 roll）；换装不再清理 legacy 槽位；修理/耐久更新只写 `item_instances`；`findEquipmentByIdForUpdate` 单查询锁定实例（并顺带修复实例装备名显示为裸 ID 的既有瑕疵）；`listEquipment/findEquipmentById/createEquipment/deleteLegacyEquipmentBySlot` 及 `characterEquipment` 表定义、世界重置清表项全部删除。堆叠表（character_items）保留不动。

## 台账

- **DEBT-021 销账**（耐久双写与整个双真源模型移除）。
- `character_equipment` 表删除后，schema 迁移（0027）即兼容窗口本体——无跨版本双模型共存。

## 验收（真 PostgreSQL，迁移前后对照）

- **属性一致**：迁移后的实例槽位/攻防基础值/耐久与 legacy 行逐字段一致；战斗属性折算同源（`equipmentRecordFromInstance` 读 baseStats + 耐久比），legacy 记录与实例记录经同一折算函数；
- **不静默覆盖**：若某 UUID 已有实例，迁移跳过且原实例数据原样保留（含耐久差异断言）；
- **幂等**：部分失败窗口（插入已执行、删表未执行）重放插入语句，不产生重复行；
- **删表**：迁移后 `character_equipment` 不存在；
- **新角色**：初始装备直接生成 equipped 实例（训练短剑 attack 2、耐久 100）；
- **修理走单源**：实例耐久 10 → 修理后 100，铜币扣减、矿石消耗照旧。

回归：`pnpm --filter @ai-mud/server typecheck` 0；`CI=true pnpm -r test` 全绿（server 40 文件 361 例 + 6 跳过、web 103、其余包全过）；`pnpm -r build` PASS；`pnpm db:verify-migrations` PASS；`pnpm test:postgres` 17/17；`pnpm verify:npc-simulation` ok:true；`pnpm arch:check` PASS（两次逐字节一致）；`pnpm arch:test` 12/12。

## 已知保留

- npc_items 数量仍走 npc 仓储（DEBT-020），与堆叠物品统一处理随 ItemService 统一切片；
- legacy 行的展示名以内容定义为准（`definition?.name ?? itemDefId`）——已知初始装备均在内容包内，名称无损；未知 key 的老数据将显示 key（契约允许：名称不在一致性验收项内）。
