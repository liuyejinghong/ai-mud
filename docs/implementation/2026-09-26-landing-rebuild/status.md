# R1 着陆重建 · 实施状态（集成线 GLM-5.3）

工作树：`/private/tmp/yudian-landing-r1-glm53`，分支 `codex/landing-r1-glm53`（基于 2783edb = main ac61a17 + 两份文档提交）。
**候选 HEAD：`4b955526e8dd91220e129f72b014c0289717c9d3`**（该 SHA 上 build/typecheck/arch:check/全仓单测 全绿；真 PG 与真浏览器在同一代码树运行通过）。

## 阶段状态

| 阶段 | 状态 | 说明 |
| --- | --- | --- |
| P 合同/探针 | VERIFIED | DTO/schema/迁移 0038/端口冻结；数值探针 P01–P05 纯计算 12/12 过（landing-rules.probe.test.ts） |
| C 内容 | VERIFIED | yudian-landing-1 全包 + 黄金数值/来源可达性测试；旧 release 数值未动（default/tutorial 测试回读原值） |
| A 设施/能源/施工 | VERIFIED | landing-rules 纯规则 + facility-effects typed 效果 + 200W 现场负载 + 储能扩容不发电 + 500Wh 门槛不套小电池 |
| B 采矿/加工 | VERIFIED | 勘探/采矿/暂停/恢复/取消命令 + 相位串行（不提前进下一工序）+ 送达才入仓 + ordinal 唯一 + 槽位维护 + 手工恢复配方 |
| D 客户端 | VERIFIED | LandingShell 固定工作区（含 legacy BaseShell 分支保留）；web 218+5 测试过 |
| I 集成 | VERIFIED | settlement 按 rulesProfile 分流；economy 能力门（新档后端拒旧订单/采购）；版本 1.0.2（schema34/api51/rules21/content17/economy7）；module-boundaries 全部新文件登记 |
| Q 验收 | 部分 VERIFIED | 真 PG 集成 9/9（G01/02/04/05/07/08/09/11/12）；真浏览器 e2e landing-postgres 1/1（U01/U02/U03+刷新）+ tutorial legacy 1/1；真人 PLAYTEST 未执行（需主控/用户） |

## 验证命令与结果（候选 SHA 见最终提交）

- `CI=true pnpm -r build` / `pnpm -r typecheck` / `pnpm -r test`（单测，无 DB 时 PG 用例按既有行为跳过）
- `pnpm arch:check`（PASS，0 uncovered）+ `pnpm arch:test`（12/12）
- 真 PG（显式 `DATABASE_URL=postgres://postgres:***@127.0.0.1:55434/postgres`，一次性容器）：
  - `apps/server` `test:integration:postgres` 17/17
  - `vitest run src/tests/base-operations`（landing 9 + 旧链 47，教程文件需 `ai_mud_ci` 库名 URL）56 用例
- 真浏览器：`REAL_E2E_PROJECT=landing-postgres node --import tsx scripts/run-real-player-e2e.ts` → 1 passed（截图在 test-results）；`REAL_E2E_PROJECT=tutorial-postgres` → 1 passed

## 遗留与风险

- 真人 30–45 分钟 PLAYTEST 未执行（主控独立验收）；G10（旧档真库副本升级演练）、G13（空库+副本整套迁移）只覆盖空库路径（临时库从 0000 全量回放），未做"生产副本"演练（无生产数据授权）。
- 浏览器自动化覆盖 U01/U02/U03 与刷新保留；U04/U05（完整生产圈、三圈再投资）的时长路径由真 PG 集成等价覆盖，真人节奏未验证。
- 旧 tutorial e2e 改为预置 legacy 基地登录回归（默认注册已是 landing-1）。
