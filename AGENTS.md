# AI MUD 开发入口

## 当前阶段：先冻结架构，不自动实施旧版本包

用户于2026-09-18要求先复核实际架构和技术选型。当前审查基线为 `690cbc816051b30e323bb005c93c1396e1303c3c`；产品仍以 `packages/shared/src/version.ts` 为准（审查时0.10.6）。文档PR不修改运行时版本。

按顺序读取：
1. `docs/implementation/2026-09-18/README.md`（2.0架构优先总控）。
2. `docs/architecture/2026-09-18-review.md`（源码事实、缺口、证据限制）。
3. `docs/architecture/target.md`（PROPOSED目标/ADR，不是现状）。
4. `docs/implementation/2026-09-18/architecture-baseline.md`（架构实施规格和门槛；需明确开工授权）。

原 `docs/architecture.md` 保留执行模型提交的现状图；其中已识别的错误以审查报告校正，不得把未来候选决策、分层纪律或完整多进程安全误称为已实现。

## 文档优先级

系统/用户本次明确要求 > 本文件与2.0总控的范围约束 > target.md和architecture-baseline.md > 被用户点名且已重基线的具体执行包 > 历史实现参考。

之前PR #1中的v0.11.0—v1.1.0包、00/01旧合同、旧implementation-prompt模板与`docs/superpowers/plans`均保留为REFERENCE_ONLY，不再凭文件里的READY/任务ID自动开工。旧F11任务已被重排；未来v0.11.0指架构收敛，不是原foundation包。

## 必守事项

- 只审查/规划时不得修改游戏源码、依赖、配置、数据库、运行版本或线上环境。
- 架构方案被接受且用户明确指派实施后，一次只执行指定ARCH任务批次；不自动进入玩法或Jev。
- 保留TS/Fastify/Postgres/Drizzle模块化单体；不先换语言、引擎、ORM或引入通用工作流。
- 数值/合法性归纯规则；命名业务用例裁决事实；所有资产变化经过显式同一事务与账本。
- AI只返回受约束提案/非权威文本；不能直接写世界；不得在数据库事务内等待模型网络。
- 读取与按需结算在职责上分开，不得直接删懒结算导致离线收益消失。
- 不改已执行迁移，不同时保留两套永久权威装备/资产路径；兼容必须有删除条件。
- 真实数据库、并发、试玩、压测和真实模型证据分别记录；缺环境写NOT_RUN，不把静态审查/mock当通过。
- 不自动合并PR、不操作生产、不自动执行重置/批量模型测试；像素包仍DESIGN_ONLY。

`CLAUDE.md`中的实跑命令和目录事实可以继续参考；其旧计划优先级及“模型只能产出文本”不是未来决策接口的定义。架构实施提示见 `docs/implementation/2026-09-18/templates/architecture-prompt.md`。
