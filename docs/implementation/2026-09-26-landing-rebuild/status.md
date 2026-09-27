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

## 返工轮补充记录（2026-09-27 晚）

- landing-fix.integration 10/10、G13 升级 2/2、landing 主集成 9/9 全部通过（隔离容器 55434）。
- 全仓 build/typecheck/arch/test 复跑全绿（server 724/web 222 含 4 项主控独立检查）。
- landing-loop 全循环 e2e 逐轮修复推进（快照透出配方运行参数；勘探显式铁矿；铜先冶炼；
  tick 粒度等待；hasFocus 钉真）：v14 已到达维护窗口截图（04），v15 修复铜料冶炼顺序后运行中。

## 返工轮续作（2026-09-27 晨，宿主重建后恢复）

- loop16 死因为宿主重建杀掉浏览器进程（error-context：`Target page...has been closed` + EPIPE），
  非测试失败；当时已过 05-expansion-done-8kW（首扩建完成、峰值 8 kW），正等圈2「制造备件」下单按钮。
- **测试基建根因修复（c7953e3）**：Playwright 每项目 testMatch 正则按含父目录的整路径匹配，
  本 worktree 目录名 `yudian-landing-r1-glm53` 中的 "landing-" 使 `/landing-.*\.spec\.ts/`
  命中**全部** spec 文件——此前每轮 "landing-postgres" 实际串行跑了 9 个测试（含 mock 向
  auth-smoke 2 项，在真服务端环境下必然失败，runner 整体退出码非零）；landing 系测试本体仍真实
  执行且通过，历史截图/断言有效，但项目归属被污染。已改为文件名锚定 glob
  （`**/landing-*.spec.ts` 等），在同名 worktree 下验证 --list 仅含 4 个 landing 规格。
- runner 新增 `REAL_E2E_GREP`（按用例名过滤），供修复后只重跑受影响场景。
- 新增规格（待跑）：`landing-control-negative.spec.ts`（HTTP 层缺/错 X-Base-Control-Token →
  409 CONTROL_EXPIRED 且无副作用＋有效租约阳性对照）、`landing-alt-route.real.spec.ts`
  （U06 先加工间替代路线：应急电全程、24 铁+4 铜→增建第二加工间、两次维护、里程碑记录）。
- loop17（nohup 脱离宿主）：`DATABASE_URL=<55434 隔离库> REAL_E2E_WORLD_TICK=true
  REAL_E2E_PROJECT=landing-postgres pnpm --filter @ai-mud/server exec tsx
  scripts/run-real-player-e2e.ts`，日志 /private/tmp/e2e-loop17.log；运行中，已过 03-ore-delivered。
- 清理被杀运行遗留的 4 个 runner 临时库（ai_mud_real_e2e_*，loop17 在用库保留）。

## 返工轮续作进展（2026-09-27 上午）

- **HTTP 层租约负例：通过（neg4）**。`REAL_E2E_GREP=控制租约` 运行 1 passed (37.7s)，runner 退出码 0。
  服务端日志铁证：POST /base/resource-nodes/:id/survey 三连 **409（缺头）/409（错头）/201（有效租约）**，
  两次被拒后快照 extractionJobs 为空（无副作用），阳性对照后队列出现「勘探」。
  证据：/private/tmp/yudian-r1-evidence/control-negative-neg4.md ＋ neg4-server.log。
  迭代记录：注册响应实返 201（谓词改 2xx）；注册后需先「恢复」让心跳取得租约；快照只透出
  controlActive 不透出 token（token 从 UI 心跳响应读取）。
- loop17 主动终止：预审发现圈2 缺陷——制造单创建即全额预留，圈1 末铁料为 0，直接下「制造备件」
  必被 409 RESOURCE_INSUFFICIENT 拒绝（此前 16 轮从未跑到圈2）。已修：圈2 先冶炼 2 批铁料
  再下备件单（e26f249）。
- loop18（主循环全链）运行中：REAL_E2E_GREP=全循环，日志 /private/tmp/e2e-loop18.log。
  修复后的项目过滤生效：本次 "Running 1 test"（此前因 testMatch 缺陷每轮混入 9 个测试）。
- 教训已记录：Playwright 每轮启动清空 apps/web/test-results，证据须跑完立即归档。
