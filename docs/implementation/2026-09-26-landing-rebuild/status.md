# R1 着陆重建 · 实施状态（返工轮 1/3 后）

工作树：`/private/tmp/yudian-landing-r1-glm53`，分支 `codex/landing-r1-glm53`。
首轮候选 4b95552；验收结论 FIX_FIRST（docs/.../acceptance-review-1.md），本轮逐条修复。
**本轮候选 HEAD：见交付报告。**

## 验收报告 9 项修复映射

| # | 问题 | 修复 | 证据 |
| --- | --- | --- | --- |
| 1 | 教程按库存余额反推历史 | deriveGoal 改单调事实派生：已送矿采矿单/已完成扩建为历史不倒退；就绪=某具体扩建模板全部输入足额；维护停机优先于备料目标 | LandingShell.acceptance-review.test.tsx 2 项过 |
| 2 | 两台筑垒不能取消/换人 | 勾选上限只禁未选项；暂停单面板提供替换设备恢复表单（onExtractionAction 带 payload） | 同上 1 项过 + NodePanel 实现 |
| 3 | 来源链是文字非闭环 | seed 物品（备件）也走配方链；步骤可点击进加工/采矿；「返回原工程」上下文条 | 同上 1 项过（备件→制造备件）|
| 4 | 非法位置建造破坏教程 | 内容 allowedSiteKeys（9 模板）→ 服务端 REQUIREMENTS_NOT_MET → UI 只列合法项 | landing-fix #4 真 PG 过（双方向非法拒绝+正确位置完成） |
| 5 | 缺租约；revision 先于幂等 | 路由收 X-Base-Control-Token + 组合根 requireLandingControl（过期/错/缺→CONTROL_EXPIRED）；全部新命令回执重放先于 revision 校验 | landing-fix #5 两项真 PG 过（缺/错 token 拒绝；跨 tick 重放原结果不重复预留） |
| 6 | 策略切换未结清旧时段 | PowerPolicyService.settleConfirmedThrough（复用 tick 结算参与，只结已确认边界） | landing-fix #6 真 PG 过（旧策略时段产出不回滚） |
| 7 | FIFO 被移除 | 创建只验能力入队（productionSiteId null）；结算逐分钟 FIFO 绑槽并持久化；暂停释放槽让后单运行；恢复重新排队 | landing-fix FIFO/双槽两项真 PG 过（A 绑 B 排队→暂停 B 运行→恢复 A 重排队；双槽各绑一单） |
| 8 | 峰值冒充实际发电 | projectLandingSupplyW（结算同源公式）→ 快照 actualGenerationW/actualSolarW → 顶栏分列 太阳能/应急/峰值 | landing-rules.probe P05b 2 项过（夜间 0+应急 1kW；积尘衰减） |
| 9 | peer persistence 类型依赖 | ExtractionService 内联 ExtractionNodeView 结构类型 | arch:check PASS（0 uncovered） |

## 验证状态（本轮候选树）

- `CI=true pnpm -r build/typecheck/test`：全绿（server 724、web 222 含主控 4 项独立检查、content 54、game-rules 61、shared 22、ai-prompts 41）。
- `pnpm arch:check` PASS + `arch:test` 12/12。
- 真 PG（隔离容器 55434）：landing 主集成 9/9、返工回归 10/10（#4/#5×2/#6/#7×2/stopping×2/
  双基地隔离/手工软锁恢复）、G13 升级 2/2、旧链 m12/p0/教程 58 用例。
- 真浏览器：landing-real（U01–U03）1/1；landing-loop 全循环（U04/U05/U07/U09）见交付报告；
  tutorial-postgres legacy 1/1。

## 已知缺口（如实）

- 真人 PLAYTEST 仍未执行（主控/用户职责）。
- 缺/错 token 的 HTTP 层字面负例未单列（组合根守卫等价覆盖；e2e 走真 HTTP 含合法 token）。
- U06 替代路线（先加工间）浏览器自动化未单列；PG 侧两路线账本已验（主集成 G07/G08b）。
