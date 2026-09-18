# MOD-02 交付记录：架构边界检查门禁（电子围栏）

- 任务：v0.11.0 / MOD-02「先实现能变红的边界检查」（modularity-baseline.md §3）
- 分支：`arch/v0.11.0-mod02-arch-gate`；基线 main `2a12d2f`（含 #1、#2 已合并内容）
- 日期：2026-09-18。性质：新增工具与合同登记；**零游戏源码/规则/迁移改动**；产品版本保持 0.10.6。

## 1. 交付物

| 文件 | 说明 |
|---|---|
| `scripts/architecture/policy.mjs` | 检查器核心：文件覆盖（fail-closed）、依赖边与 catalog 允许集校验、业务图环检测、纯层禁运行时（时钟/随机/网络/DB）、前后端边界、ai 能力禁 DB、transport 禁 DB、非字面量动态 import 禁止、public 通配泄漏、共表列归属写检查（含不可分析写法→人工清单）。**全部规则由三份冻结 JSON 程序化推导，配置不可与合同漂移**。 |
| `scripts/architecture/arch-check.mjs` | `pnpm arch:check` 入口：结构化违规输出 + 非零退出码；`--report <file>` 可导出基线报告。 |
| `scripts/architecture/arch-test.mjs` | `pnpm arch:test` 入口：在临时目录构建 NEG-01..12 探针工程，子进程运行检查器并断言红/绿，探针不进入游戏构建。 |
| `package.json` / `pnpm-lock.yaml` | 新增 `arch:check` / `arch:test` 脚本；锁定开发依赖 `dependency-cruiser@18.3.1`（exact pin）。 |
| `.github/workflows/architecture.yml` | 最小 CI：install → typecheck → test（真库用例在无 PG 环境自动跳过）→ arch:check → arch:test。 |
| 台账修正 | `legacy-boundary-debt.json`：40 条（27+1 原 + 12 补登记）；`module-boundaries.json`：2 处归属修正。见 §3。 |

## 2. 验收证据（M02）

- **探针自检**：`pnpm arch:test` → 12/12 PASS（NEG-01..11 全部变红且命中预期规则；NEG-12 正例通过）。
- **真实库基线**：`pnpm arch:check` → PASS。214 文件全部归类；发现 104 处存量违规，全部精确对账至冻结台账；**0 条未覆盖**。
- **可重复性**：连续两次运行 `--report` 输出逐字节一致（diff 为空）。
- **回归**：`pnpm -r typecheck` PASS；`CI=true pnpm -r test` PASS（593 例，全绿）。
- **一致性**：允许边不由人工配置——检查器直接读取 `module-catalog.json` 的 allowedDependencies，无法"复制后放宽"。
- NOT_RUN：web e2e（需运行中服务与浏览器，属 ARCH-09）；CI workflow 首次真实触发待 push 后观察。

## 3. Architecture Policy Change（台账补全，非新增违规）

冻结台账在检查器首跑 232 条记录的甄别后做了三类修订（修订记录已写入两份 JSON 的 `amendments` 字段）：

1. **机器可读字段补全**：为 DEBT-001—015 增补 `targetGlobs`（精确文件/目录 glob），为环相关条目增补 `coveredModuleEdges`；不改变任何条目的语义范围。
2. **存量漏登补全（DEBT-027—038）**：检查器首跑确认、且可回溯到首轮审查证据的历史项——对话服务对 game 仓储的类型导入、任务仓储对 npc 服务的类型导入（首轮 import 图在案但台账漏登）、10 个测试文件的跨模块 fixture 依赖（精确到目标文件）。
3. **归属修正（2 处）**：`input/HotkeyRegistry.ts`、`input/InputContext.tsx` 由 client_text 修正为 client_session（意图采集属会话态，ADR-07）；`world-post-tick.service.test.ts` 由 world 修正为 application（目录前缀规则曾遮蔽精确规则）。

所有修订均为**完成存量登记或修正登记错误**，无任何新增违规入列；冻结纪律不变。

## 4. 已知能力边界（诚实声明）

- 依赖边豁免按「源文件 × 目标文件/glob」匹配：在已登记的 legacy 文件内新增**指向已登记模块**的导入不会自动变红（该类文件的整文件拆除已有 ARCH 切片与删除条件）；指向**未登记模块/文件**的导入立即失败（探针 NEG-09 验证）。
- 列归属写检查按「文件 × 列 × 邻近函数名」匹配；无法解析的写法（条件展开/变量式 setter）进入人工审查清单（DEBT-039，已人工复核三处均无越界列），不默认通过。
- **v1 列归属检查仅覆盖 UPDATE 写路径**；新建行（INSERT 的初始值，含种子/托管建单）按 modularity §7 属"行创建默认值"例外类别，暂不扫描——其列级归属核对列为 ARCH-03 交付物（届时扩展检查器至 INSERT 路径并核对 escrow_copper/reward_copper 等列）。
- 静态检查不宣称证明任意动态 SQL 安全；真 PG 故障注入/并发证据仍是最终防线（ARCH-02/03 验收）。

## 5. 下一步

MOD-02 完成 → 按队列进入 ARCH-02（世界事务互斥与时间所有权），其真 PG 并发验收（G01）环境已在本轮准备就绪。
