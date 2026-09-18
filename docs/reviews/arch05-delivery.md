# ARCH-05 交付记录：结构化战斗事实与里程碑（文案降级为纯展示）

- 分支：`arch/v0.11.0-arch05-facts`（基于 main cca4706）；日期 2026-09-18
- 接口版本：40 → 41（GameLogEntryDto 新增 eventType 必填字段）；版本保持 0.10.6

## 变更

1. **战斗 timeline 携带结构化事实**：`CombatTimelineEntry` 增加 `actor: "player"|"monster"` 与 `damage?: number`；`simulateCombat` 写入。文案 message 保留但降级为纯展示。
2. **逃跑伤害改读事实**：`playerDamageFromCombatLog`（中文正则）删除；`settleCombatEscapeCost` 改经 `playerDamageFromFacts`——只汇总已播放窗口内 `actor==="monster"` 且带数值的事实条目。到期结算本就读结构化 `playerRemainingHp`，两条路径自此同源。
3. **旧纯文本不升格**：legacy timeline 条目（无 actor/damage）与 `parseActionPayload` 的纯文案回退条目（atMs=MAX_SAFE_INTEGER）均贡献零伤害——旧记录只显示、不作证（契约要求，已测试）。
4. **教程里程碑去正则**：`GameLogEntryDto`/`listRecentEvents`/`buildState` 全链路透传 `eventType`；TutorialGuide 五级进度判定全部改用结构化信号（位置、currentAction、inventory、`character.move`/`action.gathering.start`/`zone.return` 事件类型）。两条死分支（`/入账/`、`/回到.*哨站/`，全仓日志零命中）随迁移删除。
5. **NPC 摘要事件**：`NpcSummaryDto.recentEvents` 与 NPC 事件链路补 eventType（shared DTO 必填的连带）。

## 台账

- 无销账；npc-memory 的中文文本分类（`让渡了/救命/任务` 关键词打分，npc-memory.service）经全仓侦察确认仍属"改文案即改分值"模式，但它属于 NPC 记忆域而非战斗/教程事实——记为已知保留项，建议随 NPC 记忆域切片处理（侦察报告 C 节全量清单在案）。

## 验收证据（G05）

- **formatter 可替换**：game.service.test 新增用例——同一组结构化事实配中英文不同文案，逃跑扣血完全一致（7+3=10）；
- **旧纯文本不升格**：text-only timeline 条目的逃跑零成本（无可信伤害证据，不用正则兜底救）；
- **教程文案不变性**：TutorialGuide.test 新增用例——同 eventType 不同 message，进度同为满级；
- 全量回归：`pnpm -r typecheck` 0；`CI=true pnpm -r test` 全绿（server 40 文件 364 例+6 跳过、web 105、其余包全过）；`pnpm -r build` PASS；`pnpm db:verify-migrations` PASS；`pnpm test:postgres` 17/17；`pnpm verify:npc-simulation` ok:true；`pnpm arch:check` PASS（两次逐字节一致）；`pnpm arch:test` 12/12。

## 已知保留

- npc-memory 中文关键词打分（ARCH-05 范围外，已侦察在案）；
- 战斗 message 仍由 game-rules 生成（投影边界未完全外移）——但文案已非决策依据，改文案只影响显示，验收达成；
- apiVersion 41 为 DTO 必填字段变更（eventType），旧客户端若严格校验 DTO 需同步——当前 web 客户端同仓同版本，无兼容窗口问题。
