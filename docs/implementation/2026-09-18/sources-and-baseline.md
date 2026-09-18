# 来源、基线与未验证事项

日期：2026-09-18。此文件区分已有实现、设计建议和外部能力，不提供虚构的测试结论。

## 1. 源码基线

仓库：https://github.com/liuyejinghong/ai-mud

冻结head：`90df03d7d771d9ddd0b0b6524b88d9e9aef6333d`；tree：`04663724352df3df6a3747b740566f24b3f8738f`。当前产品0.10.6，版本值来自shared/version.ts，不取根package.json的0.4.0。

以下使用该head的永久文件链接；实现者仍要重新读取当前head，不能用旧行号猜代码。

- [README](https://github.com/liuyejinghong/ai-mud/blob/90df03d7d771d9ddd0b0b6524b88d9e9aef6333d/README.md)：TS全栈、服务端权威、项目当前阶段。
- [CLAUDE.md](https://github.com/liuyejinghong/ai-mud/blob/90df03d7d771d9ddd0b0b6524b88d9e9aef6333d/CLAUDE.md)：模块与运行约定、AI旧边界。
- [version.ts](https://github.com/liuyejinghong/ai-mud/blob/90df03d7d771d9ddd0b0b6524b88d9e9aef6333d/packages/shared/src/version.ts)：产品与兼容版本真源。
- [world.ts](https://github.com/liuyejinghong/ai-mud/blob/90df03d7d771d9ddd0b0b6524b88d9e9aef6333d/packages/content/src/world.ts)：四NPC、现有野图、资源和遭遇。
- [items.ts](https://github.com/liuyejinghong/ai-mud/blob/90df03d7d771d9ddd0b0b6524b88d9e9aef6333d/packages/content/src/items.ts)：商品基础价、装备、词缀。
- [economy-rules.ts](https://github.com/liuyejinghong/ai-mud/blob/90df03d7d771d9ddd0b0b6524b88d9e9aef6333d/packages/game-rules/src/economy-rules.ts)：旧批量价格取交易前单价，造成给定条件下往返套利反例。
- [game.service.ts](https://github.com/liuyejinghong/ai-mud/blob/90df03d7d771d9ddd0b0b6524b88d9e9aef6333d/apps/server/src/modules/game/game.service.ts)：市场实际调用与资产转移、战斗日志解析路径。
- [combat-rules.ts](https://github.com/liuyejinghong/ai-mud/blob/90df03d7d771d9ddd0b0b6524b88d9e9aef6333d/packages/game-rules/src/combat-rules.ts)：当前自动战斗事实与文本timeline。
- [npc-request-rules.ts](https://github.com/liuyejinghong/ai-mud/blob/90df03d7d771d9ddd0b0b6524b88d9e9aef6333d/packages/game-rules/src/npc-request-rules.ts)：原数量截断、关系阈值与保留量。
- [npc.service.ts](https://github.com/liuyejinghong/ai-mud/blob/90df03d7d771d9ddd0b0b6524b88d9e9aef6333d/apps/server/src/modules/npc/npc.service.ts)：现有世界行动和模拟入口。
- [npc-task.service.ts](https://github.com/liuyejinghong/ai-mud/blob/90df03d7d771d9ddd0b0b6524b88d9e9aef6333d/apps/server/src/modules/npc-task/npc-task.service.ts)：detectCandidates/presentCandidate/commitCandidate与真实奖励托管。
- [ledger.service.ts](https://github.com/liuyejinghong/ai-mud/blob/90df03d7d771d9ddd0b0b6524b88d9e9aef6333d/apps/server/src/modules/ledger/ledger.service.ts)：现有player/npc/municipal/escrow/system_source/system_sink桶与对账。
- [ai-provider.ts](https://github.com/liuyejinghong/ai-mud/blob/90df03d7d771d9ddd0b0b6524b88d9e9aef6333d/apps/server/src/modules/ai/ai-provider.ts)：目前只有completeJson，不是native decision接口。
- [ai-purpose-policy.ts](https://github.com/liuyejinghong/ai-mud/blob/90df03d7d771d9ddd0b0b6524b88d9e9aef6333d/apps/server/src/modules/ai/ai-purpose-policy.ts)：目前purpose/权限与token上限。
- [npc-task-proposal.ts](https://github.com/liuyejinghong/ai-mud/blob/90df03d7d771d9ddd0b0b6524b88d9e9aef6333d/packages/ai-prompts/src/npc-task-proposal.ts)：当前所谓proposal输出仍以文案为主，不是选执行动作。
- [dialogue.service.ts](https://github.com/liuyejinghong/ai-mud/blob/90df03d7d771d9ddd0b0b6524b88d9e9aef6333d/apps/server/src/modules/dialogue/dialogue.service.ts)：目前对白名单与规则赠予桥接。
- [TutorialGuide.tsx](https://github.com/liuyejinghong/ai-mud/blob/90df03d7d771d9ddd0b0b6524b88d9e9aef6333d/apps/web/src/features/game/ui/TutorialGuide.tsx)：旧五步教程与日志文本推断。
- [useGameSync.ts](https://github.com/liuyejinghong/ai-mud/blob/90df03d7d771d9ddd0b0b6524b88d9e9aef6333d/apps/web/src/features/game/sync/useGameSync.ts)：现有单轮询同步，默认3秒/15秒。
- [map-rules.ts](https://github.com/liuyejinghong/ai-mud/blob/90df03d7d771d9ddd0b0b6524b88d9e9aef6333d/packages/game-rules/src/map-rules.ts)：当前移动只验证边界，需为未来障碍补逻辑合同。

旧v0.10.7候选闭环计划的核心方向被保留，但新计划不沿用“必须由模型生成中文自由理由”的输出要求。旧v1.0计划不再作为自动开工排期；它仍可提供具体代码参考。

## 2. 外部来源

### TypeSafe

官方入口：https://typesafe.ai/

2026-09-18检索到的官方主页摘要描述typed decisions，并展示每十亿输入token42美元的价格（换算为每百万0.042美元）。这不是你的部署实测，不是固定不变的合同，也不代表完整NPC成本。

本轮尝试访问以下官方页面时获取失败，因此不将其具体API字段、限速、context限制、SDK版本、模型ID和数据保留选项标为已核验：
- https://docs.typesafe.ai/
- https://docs.typesafe.ai/models
- https://docs.typesafe.ai/primitives
- https://docs.typesafe.ai/model-jaggedness/jev-1.13
- https://typesafe.ai/blog/introducing-system-one-models-and-jev

J14-T01要求在实施时核对官方文档/SDK并冻结合同。本计划不采用第三方示例里的HTTP字段冒充官方规范，不将此前聊天提及的延迟、Doom演示或默认速率作为验收证据。

### Phaser

已读取官方文章（2024-02-26发布）：
https://phaser.io/news/2024/02/official-phaser-3-and-react-template

文章确认有React/Vite集成模板及Canvas外React UI的工作方式。它支持本计划的架构选择，不证明某一2026最新major API兼容；未来开工必须锁定实际版本。

### Godot

已读取官方2D文档：
https://docs.godotengine.org/en/stable/tutorials/2d/

文档说明其专用2D渲染/物理、tilemaps、粒子与动画支持。本计划仅据此将它作为原生/编辑器导向备选，不宣称已完成本仓库Godot移植成本测试。

## 3. 本轮没有做的事

未启动完整游戏；未执行其单测/PG/E2E；未调用DeepSeek/Jev；未招募真人；未进行7天观察；未安装Phaser；未修改游戏源码/运行版本/数据库/配置/依赖。版本包中的数值、里程碑、性能目标和验收阈值都是待验证的设计。

对市场新公式已进行纸面与独立算术复核，黄金值不是一次线上交易记录。最终实施仍须在真实代码和PG调用链复现与回归。
