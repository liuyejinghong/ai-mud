# 浏览器验收环境独立核验与 R0 记录

日期：2026-09-21。环境 PR #22；独立评审场景与报告 PR #23。

## 结论

**执行与取证链路已由独立评审方接通；PR #22 合并前先修下面两个 P1 证据可靠性问题，不需要重搭环境。** 原始证据可用于有限检查，摘要字段暂不能直接作为验收依据。

- INFRA_EXECUTION：VERIFIED。
- HANDOFF：VERIFIED；评审方新增场景、创建普通 PR、自动触发、下载并解压证据，全部实际完成。
- EVIDENCE_SUMMARY：NEEDS_FIX。
- GAME_ACCEPTANCE：PARTIAL_FAIL；仅本轮有限范围，不是完整游戏验收。
- 未合并任何 PR；未修改产品代码、线上部署、生产账号或数据库。

## 固定版本与运行

| 对象 | 标识 |
|---|---|
| 游戏实现基线 | `fad7d4232937d6c3fb216d743edb227589846803` |
| 独立审查的环境提交 | `b14ee1603fa06a4d4f2259db7c96fb98e8188ab7` |
| 评审场景提交 | `eadab8a6bf02f4a44c7bee8edee533efc87ab909` |
| R0 实际 checkout / merge commit | `2e717fa0a79a341234bbf6a111e734e27f521145` |
| 独立运行 | [35560150903](https://github.com/liuyejinghong/ai-mud/actions/runs/35560150903)，attempt 1 |
| artifact | `10621857546`；`playtest-evidence-35560150903-attempt1` |
| 到期 | `2026-09-28T04:15:04Z` |
| ZIP SHA-256 | `d67eca6e1966686bad019843509df20c6c16a03ca897bc071a6fa1b88f4d35e7` |

评审方还实际下载、解压并检查了交付方两轮产物：

| run | artifact | 独立检查结果 |
|---|---|---|
| 35559430526 | 10622015680 | 1 场景、7 步、14 张步骤截图；注册/选择设施/计时往返吻合 |
| 35559612804 | 10621362527 | 2 场景、10 步、20 张步骤截图；新场景及独立账号吻合 |

第二轮 ZIP 摘要与 GitHub digest 一致：`b81a87e0e3386a26c72db383dc965138cc67adf2570e9fe8eb9ff54307d377ce`。已存在文件的大小均匹配 manifest，但有隐藏文件被索引而未上传，见 ENV-R03。

本轮基于环境分支另开 `review/browser-handoff-20260921`，PR #23 目标为 `infra/browser-review-env`，实际触发成功。**不需要先合并 #22 才能完成交接。** 本报告是运行完成后的文档追加，不冒称报告提交本身已经被该运行测试；文档提交也可能再次触发已有 PR 的 workflow。

## 环境问题：2 个 P1、2 个 P2

### ENV-R01 · P1 · 业务操作未生效的告警漏报

**确认方式：源码表达式隔离复现，不是说原两次绿跑计时失败。**

`tests/playtest/scenarios/environment-smoke.spec.ts` 在观察不到变化时实际生成 `resume_no_change_after_click` / `pause_no_change_after_click`，并只记录 note，不抛错。`scripts/playtest/collect-evidence.mjs` 却仅匹配完全等于 `no_change_after_click`。

对两端原表达式做独立 Node 实验：输入两个未变化记录，输出 `game_blocked_candidates=[]`、`SMOKE_PASSED`，预期应捕获两个业务阻塞候选。

源码锚点：[smoke](https://github.com/liuyejinghong/ai-mud/blob/b14ee1603fa06a4d4f2259db7c96fb98e8188ab7/tests/playtest/scenarios/environment-smoke.spec.ts)、[collector](https://github.com/liuyejinghong/ai-mud/blob/b14ee1603fa06a4d4f2259db7c96fb98e8188ab7/scripts/playtest/collect-evidence.mjs)。

修复标准：生产者/消费者共用结构化结果，区分基础设施执行、场景执行与业务效果；resume/pause 无变化各有负例，摘要明确呈现阻塞，保留原始证据。不要求把业务失败误写成服务启动失败。

### ENV-R02 · P1 · manifest 的环境与基线字段不准确

**确认方式：源码与本轮原始产物交叉核验。**

R0 窄屏实际为 **390×844**：`page.viewportSize()`、trace context 均为该值，截图宽度 390 px；页面测量 `innerWidth=390, innerHeight=844, documentWidth=390`。最终 manifest 却仍写硬编码 **1440x900**。浏览器实际版本由本轮额外记录为 `149.0.7827.55`，原采集器只记 Playwright 版本。

堆叠 PR #23 的 `game_implementation_base_sha` 又被填成环境提交 `b14ee160…`，解释仍写“base 分支 v0.12.0-base-operations”；本轮 PR base 实际是 `infra/browser-review-env`。实际 checkout 字段正确，但基线解释会误导。

修复标准：每场景采集实际 viewport/browser/timezone/project 配置；混合尺寸不能用一个默认值覆盖。区分 actual checkout、PR base/head、明确冻结的产品基线，未知值标 UNKNOWN。默认配置可以另列 configured_default，不能冒充运行事实。增加桌面+窄屏混合及堆叠 PR 的采集回归。

### ENV-R03 · P2 · 文件索引与 ZIP 不一致

交付方两轮及 R0 的 manifest 均索引 `test-results/.last-run.json`，下载 ZIP 中均不存在。关键截图与 trace 仍可读取，其他已存在文件大小一致。

修复标准：让 manifest 使用与上传一致的安全文件白名单，或不索引不需要上传的隐藏文件；解压后逐项验证。不要为了这一个文件盲目开启全部隐藏文件上传，避免夹带 `.env` 等内容。

### ENV-R04 · P2 · 文档更新“不触发”的说明不符事实

交付说明称最后文档提交未触发第三次运行。API 实际确认 `b14ee160…` 关联 [run 35559793253](https://github.com/liuyejinghong/ai-mud/actions/runs/35559793253)，run_number 5，success。本条仅核对 API 元数据，没有另行下载该轮产物。

修复标准：更正文档对触发与费用的说明，按真实 PR 变更集理解路径过滤。无需为了维持旧说法而改触发策略。

## 独立 R0 游戏路径

全部通过页面操作；没有直接业务 API 写入、DOM 成功状态注入、模拟时钟修改、mock 或产品修复。每个测试使用独立新档与浏览器上下文。

总计 **5 个测试（原有 2 个 + 新增 3 个）：4 passed / 1 failed；27 步，54 张前后步骤截图引用全部有效**。Actions failure 来自刷新断言，不是部署失败。

| 新增场景 | 结果 | 已证实的有限范围 |
|---|---|---|
| 普通玩家刷新后保持控制可用 | FAIL | 基地仍显示，但恢复计时持续禁用 |
| 暂停新档创建工程→查看→确认取消 | PASS | 工程位重新可建，库存显示与初始一致；未验证已施工退款或数据库账本 |
| 390×844 注册→引导→选择建设位 | PASS | 该路径可操作、采样点无横向溢出；不等于全部页面或真实触控兼容性通过 |

### GAME-R01 / 历史 AUTH-01 · P1 · 普通玩家刷新后无法恢复计时

**独立 CI 浏览器已复现 1 次；目标公网部署未复验。** 历史 AUTH-01 可以在独立部署范围升级为确认，不改变其他候选或线上验收状态。

复现：
1. 干净上下文，通过页面注册普通账号，获得初始暂停的新基地。
2. 关闭新手引导，确认“恢复计时”原本可用。
3. 浏览器刷新，等待基地地图重新出现。
4. 断言该按钮恢复可用；在 **12,000 ms** 窗口内持续禁用，Playwright 28 次定位均得到带 `disabled` 的按钮。

刷新后 `/auth/me` 为 200，`/base/snapshot` 在 04:14:44.733、04:14:49.701、04:14:54.702 UTC 均为 200，基地/库存继续显示。未把登录前正常 401 当故障。失败截图中恢复计时与倍率按钮变灰。

影响：普通刷新后读取成功但无法通过该按钮推进基地。本轮没有证明永久卡死、全部其他命令失败或退出重登能恢复，不能扩写结论。

定位线索：[BaseApp.tsx](https://github.com/liuyejinghong/ai-mud/blob/fad7d4232937d6c3fb216d743edb227589846803/apps/web/src/features/base/BaseApp.tsx) 的 CSRF 状态仅用 `useState(initialCsrfToken)` 初始化；[App.tsx](https://github.com/liuyejinghong/ai-mud/blob/fad7d4232937d6c3fb216d743edb227589846803/apps/web/src/App.tsx) 异步恢复 session。这与历史候选解释一致；直接证据是页面控制失效。

修复验收：保留失败场景；普通玩家硬刷新无需重新登录即可恢复/暂停与切换倍率，再验证会话/CSRF 一致、写请求和心跳续租。管理员、重新登录各自回归，不通过关闭 CSRF 修复。

证据定位：artifact 内 `steps.jsonl` 的 scenario `reviewer-handoff-spec-ts-R0-refresh-retains-usable-controls` / step `reload`；`screenshots/.../reload-before.png`、`reload-after.png`、`reload-error.png`；对应 trace 与 network.jsonl。

## 保留项、边界与下一步

应保留：独立新档、真实 UI、首次失败不重试、成功失败都录 trace、失败步骤仍保留截图、普通 PR 能触发且评审方能下载。建设取消损失提示与暂停未开工取消路径已测，应保留回归；不代表所有资产返还情况通过。

未测：完整工程完工、制造逐台产出、订单/采购到货闭环、昼夜/尘暴、离线租约、管理内容工坊、多账号边界与长期节奏。暂不提供整体好玩/不好玩裁决。

本轮 loopback HTTP 实际 `window.isSecureContext=true`；不能用本轮建设成功消除公网 HTTP `crypto.randomUUID()` 的历史 TECH-01 候选。公网入口、生产数据、部署 SHA 仍未复验。

执行 agent 的最小后续范围：在 #22 修 ENV-R01/02 并补负例，顺带修索引与触发说明，只改基础设施/文档。游戏 AUTH-01 留在独立产品修复中，保留 R0 失败原始证据。完成后重新交付 run 与 artifact，不能把“环境通过”和“游戏通过”合并成一句话。
