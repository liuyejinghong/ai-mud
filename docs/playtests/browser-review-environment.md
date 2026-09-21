# 浏览器验收环境交接文档（browser-review）

> 交付物：评审 agent 无需重新搭环境，即可增写操作场景 → 触发 Actions 真实游戏 + 真实浏览器 → 取回证据包。
> 本文档只覆盖环境与通道；玩法验收（GAME_ACCEPTANCE）由后续独立评审执行。

## 1. 环境 PR 与基线

- **环境 PR：[#22](https://github.com/liuyejinghong/ai-mud/pull/22)**，分支 `infra/browser-review-env`，目标分支 `v0.12.0-base-operations`。
- **基于的游戏提交：`fad7d4232937d6c3fb216d743edb227589846803`**（实现 PR #20 的 head，当时未合并；因此本 PR 以实现分支为目标，diff 仅含基础设施 14 个文件，不含任何游戏实现）。
- 文件清单：`.github/workflows/browser-review.yml`、`tests/playtest/`（config/fixtures/scenarios/包定义）、`scripts/playtest/`（serve-web / wait-for / collect-evidence）、`pnpm-workspace.yaml` + `pnpm-lock.yaml`（新增 workspace 包 `@ai-mud/playtest`，锁文件 +12 行）。

## 2. 证明触发通道的运行记录

| 轮次 | run | 触发 | 提交 | 结果 | 证据 |
|---|---|---|---|---|---|
| 首次绿跑 | [35559430526](https://github.com/liuyejinghong/ai-mud/actions/runs/35559430526) | PR #22 场景/工作流变更（pull_request 事件） | PR head `e8ad391`，实际运行 merge commit `8694818` | success，1m24s，7 步 | artifact `10622015680` |
| 场景更新再触发 | [35559612804](https://github.com/liuyejinghong/ai-mud/actions/runs/35559612804) | 提交新场景 `reviewer/example-touch.spec.ts` | PR head `af9ff61`，merge commit `bda3b9d` | success，1m18s，**两个场景都运行**（smoke 7 步 + example-touch 3 步） | artifact `10621362527` |
| 文档提交后再触发 | [35559793253](https://github.com/liuyejinghong/ai-mud/actions/runs/35559793253) | PR #22 后续提交（含文档提交 `b14ee16`） | PR head `b14ee16` | success | 独立评审核验 |

> **更正（2026-09-21 评审 ENV-R04）**：本文档早先称"最后文档提交不触发第三轮"是**错误的**。`pull_request` 的路径过滤评估的是**整个 PR 相对 merge-base 的变更文件集合**，不是逐 commit 检查——PR 一旦包含 `tests/playtest/**` 等路径，其后续任何 push（即使只改 docs）都会重新评估并触发运行。上表第三轮即文档提交 `b14ee16` 触发的 run 35559793253（success）。由此产生的额外运行是预期行为：有 concurrency 组串行化、无定时任务、无重试；不为此修改触发规则。

## 3. 评审 agent 在哪里提交下一份操作脚本

- **分支**：基于 `infra/browser-review-env`（PR #22 合并后则基于 `v0.12.0-base-operations`）。
- **路径**：`tests/playtest/scenarios/reviewer/<你的场景名>.spec.ts`。
- 模板：`tests/playtest/scenarios/reviewer/example-touch.spec.ts`（已实际跑通）；约定见同目录 README。

## 4. 触发方式与定向运行

- **PR 触发（已验证）**：修改 `tests/playtest/**`、`scripts/playtest/**` 或 workflow 文件并提交 PR → 自动运行（注意第 2 节更正：过滤按 PR 全量变更集评估，PR 后续 push 会再次触发）。PR 触发时**运行 scenarios/ 下全部场景**。新 workflow 文件在未合并的 PR 里即可触发（pull_request 事件使用 PR merge ref 上的 workflow），已由上表运行证明。
- **workflow_dispatch（受限）**：仅当 workflow 文件出现在**默认分支 main** 后才可手动触发（GitHub 前置条件）。当前 PR 目标是实现分支，未合入 main 前没有手动入口——这是预期行为，不是缺陷。合并到 main 后：Actions → browser-review → Run workflow，`scenario_grep` 填场景标题标识词（如 `example-touch`）即可只跑一个场景；`product_baseline_sha` 可选提供冻结的产品基线（不提供则 manifest 记 UNKNOWN）。参数经 env 传给 `--grep`，不进 shell 拼接。
- 不需要评审 agent 拥有 dispatch API 权限：普通 PR 提交即可触发。
- 不修改默认分支、不降低分支保护、不用 `pull_request_target`。

## 5. 最小场景模板与运行命令

模板：`tests/playtest/scenarios/reviewer/example-touch.spec.ts`（注册进基地 → 点开第一个设施 → 证据落盘）。

本地运行（需先按第 8 节起服务）：

```bash
cd tests/playtest
PLAYTEST_BASE_URL=http://127.0.0.1:4173 PLAYTEST_EVIDENCE_DIR=evidence \
  pnpm exec playwright test scenarios/reviewer/example-touch.spec.ts
```

CI 内定向运行（workflow_dispatch 合入 main 后）：`scenario_grep=example-touch`。

## 6. 如何读取证据

每次运行上传 artifact `playtest-evidence-<run_id>-attempt<n>`，结构：

| 文件 | 内容 |
|---|---|
| `summary.md` | 一页摘要：状态/版本/自检/场景表/业务检查/证据索引（同步显示在作业 Summary 页） |
| `manifest.json` | 机器可读全量清单（schema v2：状态词典、版本四元组、逐场景 runtime、结构化业务检查 + 文件索引） |
| `steps.jsonl` | 每步：step_id、时间、意图、实际操作、前后 URL/标题/可见文本、截图路径、结果/异常 |
| `screenshots/` | 每步前后 + 失败时整页截图 |
| `console.jsonl` / `network.jsonl` | 控制台与 pageerror；请求/响应（≥400 仅标记不判失败）+ 失败请求 |
| `test-results/`、`playwright-report/` | trace（成功也录，`trace: on`）与 HTML 报告 |
| `server.log` / `web.log` | 后端/前端进程日志 |
| `selfcheck.json` / `tool-versions.txt` | 三项就绪探测结果；node/pnpm/git SHA |

**运行状态词典（manifest.status）**：`SMOKE_PASSED`（场景全过 + 业务检查全部生效 + 就绪齐全）/ `GAME_BLOCKED`（场景执行完但业务动作未生效——游戏问题候选，摘要显式列出）/ `SMOKE_FAILED`（场景断言失败）/ `SMOKE_INCONCLUSIVE`（场景过但必要就绪记录缺失，不判成功）/ `BLOCKED_BEFORE_TESTS`（环境未就绪）/ `NO_SCENARIO_RAN`。

**业务检查合同（v2，生产者 fixture ↔ 消费者 collector 一致）**：场景通过 `evidence.businessCheck(check, result, detail?)` 记录结构化结果，`result ∈ {effective, no_change, error, not_executed}`；任何非 `effective` 都使整体状态为 `GAME_BLOCKED` 并进入 `game_blocked_candidates`。信息性观察仍走 `evidence.note()`（不入业务判定）。区分三层：①基础设施就绪（selfcheck）②场景执行（status）③业务生效（business_status）——三者独立判定，业务失败不会误分类为启动失败。

**清单与 ZIP 一致性**：`evidence_files` 索引跳过隐藏文件（与 upload-artifact 默认行为一致，不为单文件开启隐藏文件上传）与清单自身（manifest/summary 不入索引，避免自引用）。交付方每次实跑后按以下协议核验：下载 ZIP → `shasum -a 256` → 解压 → 逐项核对索引存在与字节数一致 → 抽查截图/trace 可读 → 记录差异（有差异即修复）。

下载：

```bash
gh run download 35559612804 -n playtest-evidence-35559612804-attempt1 -R liuyejinghong/ai-mud
```

本任务的两次产物均已由交付方实际下载、解压并与 manifest 逐项核对（文件数、版本三元组、脱敏、独立账号）。

## 7. 已产生运行的事实数据

| 轮次 | run_id | artifact_id | artifact 过期时间 |
|---|---|---|---|
| 首跑 | 35559430526 | 10622015680 | 2026-09-28T04:01:53Z（retention 7 天） |
| 第二轮 | 35559612804 | 10621362527 | 2026-09-28T04:04:55Z（retention 7 天） |
| 第三轮（文档提交触发，评审核验） | 35559793253 | 10621857546 | 2026-09-28T04:15:04Z（retention 7 天） |
| 整改轮 A（ENV-R01~04 修复后，PR #22） | 35569569241 | 10624659810 | 2026-09-28T06:42:58Z（retention 7 天） |
| 整改轮 B 首跑（集成验证，2 场景失败，证据保留） | 35570525938 | （见 manifest） | 2026-09-28（retention 7 天） |
| 整改轮 B2（集成验证全绿，PR #25） | 35571080360 | 10626316959 | 2026-09-28T07:06:45Z（retention 7 天） |

## 整改轮记录（2026-09-21 评审反馈 ENV-R01~R04，追加不改写历史）

- **ENV-R01（业务漏报）**：业务检查改结构化合同 `evidence.businessCheck(effective/no_change/error/not_executed)`；collector 纯函数化并引入状态词典（`SMOKE_PASSED`/`GAME_BLOCKED`/`SMOKE_FAILED`/`SMOKE_INCONCLUSIVE`/`BLOCKED_BEFORE_TESTS`/`NO_SCENARIO_RAN`），业务未生效显式判 `GAME_BLOCKED`，就绪缺失不判成功。合成输入单元回归 11 例（`node --test scripts/playtest/`，CI 内执行），负例均能在摘要与 manifest 中显式出现。
- **ENV-R02（元数据写死/版本来源）**：manifest schema v2 逐场景记录实际 runtime（viewport 初/终、browser name/version、project、timezone；配置默认值放 `configured_default`）；版本来源四元组（actual checkout / PR head / PR base / product baseline），PR base 不再冒充产品基线，未提供时记 UNKNOWN 并说明；可选 workflow 输入 `PRODUCT_BASELINE_SHA`。整改轮 B2 实测混合视口：6 场景 1440×900 + 1 场景 390×844 逐场景各记其值。
- **ENV-R03（索引与 ZIP 不一致）**：索引跳过隐藏文件与清单自身，与上传规则一致；交付方核验协议：下载 ZIP → SHA-256 → 解压逐项核对存在性与字节数 → 抽查截图/trace 可读。整改轮 A 实测 58/58 文件零差异，B2 实测 143/143 零差异。
- **ENV-R04（触发说明不实）**：已在第 2 节更正——`pull_request` 路径过滤按 PR 全量变更集评估，文档提交 b14ee16 确实触发了 run 35559793253。

整改轮运行（PR #25 临时集成验证，勿合并）：B 首跑 2 场景失败（刷新回归场景未先恢复暂停态就刷新、管理员登录后 role 被产品缺陷降级 player），失败证据完整保留于 artifact；前者属场景脚本逻辑、后者转入产品 PR #24 修复（`session.user.role` 读取 + 组件回归）；B2 全绿 7 场景，含原 GAME_BLOCKED 的 R0 刷新场景。

版本区分口径（见 manifest.versions）：`actual_checkout.sha` = 实际被运行代码（pull_request 事件下 = GitHub 自动生成的 merge commit）；`pull_request.head_sha` = 场景/基础设施提交；`pull_request.base_sha` = 堆叠目标分支快照（**不是**产品基线）；`product_baseline.sha` = 冻结的产品基线，仅在 workflow 输入提供时记录，否则 UNKNOWN 并说明来源不足。报告版本时不可混用。

## 8. 数据重置与和线上的差异

**每轮完全重置**：PG 是每作业新建的 service 容器（运行结束销毁）；测试账号一次性（页面注册创建）；浏览器 context 全新（无 storageState）；无任何跨运行缓存游戏数据。

与线上部署（`deploy/docker-compose.prod.yml` + nginx，VPS cp01:8088）的差异：

| 项 | 线上 | 本环境 |
|---|---|---|
| 前端服务 | nginx 容器 | `scripts/playtest/serve-web.mjs`（node 静态 + 反代，路径语义同 nginx 的 `^/(auth|base|admin|health)`，SPA 回退一致） |
| 数据库 | 持久卷 | 一次性容器 |
| 暴露 | 0.0.0.0:8088 对外 | 仅 127.0.0.1，无对外地址/调试端口/隧道 |
| 注册 | PLAYTEST_REGISTRATION_ENABLED=true（内测） | 同 true（评审需要）；账号一次性 |
| 模型 | TYPE_SAFE_DECISION_MODE 可配 | template/off/false 全关，无付费调用 |
| Cookie | SESSION_COOKIE_SECURE=false（HTTP 内测） | 同 false（127.0.0.1 回环 HTTP） |

后端启动链与生产镜像**完全一致**：构建 4 个共享包 → drizzle 迁移 → `node --import tsx src/main.ts`。

## 9. 已验证 / 阻塞清单

已验证：
- 全新 runner 完成 安装→迁移→服务启动（就绪探测：PG 实查、/health、首页非空，非固定 sleep）；
- 浏览器打开真实游戏页面（非白屏/错误页，首页断言"进入你的基地"）；
- 页面注册一次性账号并进入基地（两轮 4 个账号全部成功）；
- 真实控件操作并取证（关闭引导、选择"建设位 A"并确认详情、计时暂停↔恢复往返，时钟命令 POST 200 已入证据）；
- 证据包在成功与失败路径都完整落盘（曾有一次 CI 失败：run 35559308532 的 artifact 含 manifest（状态 NO_SCENARIO_RAN）+ tool-versions，失败原因已修复）；
- 场景变更→自动再触发（第二次运行），独立数据；
- 服务端日志、脱敏（network.jsonl 中 password=`***`）、trace 常开。

阻塞：无基础设施阻塞。
未执行：玩法验收、平衡评审、问题定级——GAME_ACCEPTANCE=NOT_PERFORMED。
限制：workflow_dispatch 在本 PR 合入 main 前不可用（第 4 节）；后续评审方能否通过其连接器读取 artifact，由评审方接手后自行验证。

## 10. 需要用户的人工动作

只有一项决策：**是否合并 PR #22**（以及何时合并）。合并不是自动的；本任务不合并任何 PR。
合并 #22 后如需手动定向跑场景，需等 workflow 随实现分支进入 main（第 4 节前置条件），无需其他配置动作。

## 附：时间口径与隐私

- `manifest.timing` 为真实墙钟；游戏内是独立模拟时间（页面显示"基地时间 HH:MM"）。脚本等待/轮询时长不代表玩家体验。
- 脱敏：steps/console/network 中 password/secret/token/authorization/cookie/csrf 已掩码；trace 含一次性账号表单内容（该账号与数据库随作业销毁，artifact 7 天过期）；不含 .env、生产凭据、数据库转储、持久会话。
