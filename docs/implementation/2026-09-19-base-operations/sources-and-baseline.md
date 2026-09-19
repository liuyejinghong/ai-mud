# 来源、基线与验证限制

## 1. 本路线的授权来源

2026-09-19，项目所有者在讨论中确认“一个A0＋六个交付版本”，随后明确要求提交PR。方案经过以下收敛：西幻MUD→余电游戏→地球远程基地经营；新人不学习小说高概念；鼠标操作；工程队开局；Agent Harness可见真实todo；Jev有限决策；可复用模板/制造与动态内容发布。

此文件记录决定，不声称聊天讨论已替代代码验收。当前授权是提交规划PR；实施范围、合并、生产操作与付费批测另行指定。

## 2. 仓库基线

主线确认：`e2677eab514ab7e347a340163282b2d48aeb2788`。

- [产品版本](https://github.com/liuyejinghong/ai-mud/blob/e2677eab514ab7e347a340163282b2d48aeb2788/packages/shared/src/version.ts)：0.11.0；schema28/api41/engine2/ruleset17/content12/prompt8/economy4/worldSeed1。
- [当前根脚本](https://github.com/liuyejinghong/ai-mud/blob/e2677eab514ab7e347a340163282b2d48aeb2788/package.json)：有arch:check/arch:test/test:postgres等；根package的0.4.0不是产品运行版本。
- [旧开发入口](https://github.com/liuyejinghong/ai-mud/blob/e2677eab514ab7e347a340163282b2d48aeb2788/AGENTS.md)：开头仍含旧0.10.6和未实施状态，后文已有MOD-02交付说明；新入口纠正排期，不抹掉历史。
- [旧PC合同](https://github.com/liuyejinghong/ai-mud/blob/e2677eab514ab7e347a340163282b2d48aeb2788/docs/architecture/project-constitution.md)：通用约束继续适用，其当时状态说明不是当前运行证据。
- [PR #18](https://github.com/liuyejinghong/ai-mud/pull/18)：head `c65c5f83800032ece31897fd56c47adcd707d546`，需求简报与后续评论是演变背景；原改名三线计划不再是实施顺序。

参考源码路径（在该基线已存在）：auth/auth.routes.ts、game/GameService及repository、world-runtime、npc/npc.service.ts、npc-memory、item/ledger、ai provider/orchestrator；packages/content/src/items.ts与world.ts；packages/shared/src/game.ts；web/features/game的GameShell/GameHud/controller。它们是盘点入口，不意味着可以不顾public边界直接复用内部。

本轮读取了主线/PR元信息、AGENTS、PC、旧总控、package.json和version.ts以建立文档基线。前轮源码审查提供的问题仍需实施时复核；没有因新路线而重新声称全库零债务或某数量测试已通过。

## 3. 正典与第三方接口

《余电》正典参考锁定：仓库 `liuyejinghong/yudian-universe` 的 `e839275470373a40f52329ffd17c092b0bdfebc4`。阅读docs/canon-policy.md、chronology、setting/technology-and-infrastructure、economy-and-labor、continuity、RIGHTS.md和stories/yudian/final.md。成稿正文虽位于draft目录，冻结登记的A级优先级不能按目录名字否定。

A0确认游戏时代/改编层、资源名称与物理单位；无明确电影清单，不自行融合其他IP或复制素材。约12台设备和第一场天气仅是游戏初值，不是任何现实任务的承诺。

Jev实施时再核实TypeSafe官方docs与 `typesafe-ai/typesafe-sdk-js` 的版本/模型/端点/超时/重试/价格；不要直接锁旧对话中的价格与延迟。DuckDB仅为分析候选，实际依赖版本由授权实施时验证，不增加在线数据库。本文不是本轮对外部最新状态的重新研究。

## 4. 当前存在的验证命令

以下来自基线package.json，本轮没有执行：

```sh
pnpm typecheck
pnpm test
pnpm arch:check
pnpm arch:test
pnpm test:postgres
pnpm db:verify-migrations
```

根DB相关命令会读取`.env`。执行前必须确认临时数据库和权限，不拿未知环境代跑；db:verify-world-reset、仿真/reset脚本在未审清副作用前不执行。E2E命令按实施时实际web package与Playwright配置选择，不能猜路径后把0测试当通过。

## 5. 本PR验证口径

可以验证：文档路径、计划JSON可解析、工作包依赖无环、版本/任务/GATE覆盖、远端提交文件范围与批准路线一致。

不宣称完成：游戏源码修改、模板/制造/Harness/模型运行实现、真实数据库/E2E/负载、真人试玩、模型API性能、现有架构全量审计。CI即使自动运行成功，也不能证明文档中尚未实施的玩法已通过。

实际PR head、文件数、文档验证结果以PR说明与最终回读为准。只在明确的分支提交文档，不修改main、生产或分支保护。
