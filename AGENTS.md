# AI MUD /《余电》基地经营开发入口

## 当前基线与授权

2026-09-19确认的源码基线为 `e2677eab514ab7e347a340163282b2d48aeb2788`，产品版本 `packages/shared/src/version.ts` 为0.11.0。每次实施核对actual HEAD/工作树；不要把旧文档的0.10.6、PROPOSED或“未实现检查器”当当前结论。

用户已批准新的基地经营里程碑并授权提交文档PR；不代表已实现，也不授权自动实施全路线、合并、生产操作或付费批测。先等待本轮明确指定的A0或Mxx工作包。

## 唯一后续排期入口

1. `docs/implementation/2026-09-19-base-operations/README.md`
2. 同目录 `00-scope-and-a0.md`、`01-domain-contracts.md`、`02-parallel-development.md`
3. 用户指定的一个版本包及 `templates/` 内提示词/单线合同/证据模板。
4. `docs/architecture/project-constitution.md`、`modularity.md` 的通用PC/封装约束，以及真实源码/边界台账。

新路线：A0 → v0.12接管基地 → v0.13内容/制造 → v0.14Jev协作 → v0.15能源/尘暴 → v0.16经营 → v1.0内测。v1.1像素仍DESIGN_ONLY，另行授权。

`docs/implementation/2026-09-18/`、superpowers历史计划及PR #18原三线改名方案仅作历史排期/实现参考；不得凭旧READY或F11/ARCH编号自动开工，不重复已交付v0.11工作。旧角色/共享镇的产品假设由新scope合同替代，资产/事务/权限等不变量继续。

## 约束优先级

系统/用户本次明确要求 > 本文件与新总控的授权/范围 > 新领域合同对基地/内容/时间的明确变更＋通用PC/模块化纪律 > 新版指定工作包 > 旧实现参考。

新增industry/content-catalog等允许边与字段归属在A0/P单列Architecture Policy Change并独立确认；新玩法不是绕过当前arch检查的理由。当前检查器已存在，实际命令以package.json为准。更新其配置只能为批准的边界，不为让违规变绿。

## 必守开发规则

- 无实施授权只读/规划；不改源码、依赖、配置、版本、DB或生产，不自动合并PR。
- 一版本一授权批次；先P冻结public合同/共同fixtures/精确文件所有权，再A—D并发，Q独立验收，I统一交付。每线独立worktree/测试DB/端口。
- public API是类型化进程内能力，不做跨模块localhost HTTP；禁止peer internal/repo、ORM记录泄漏、全局db逃生口和service locator。
- 一事实一写者；UoW绑定模块public参与接口，应用用例不执行任意SQL，platform不反向import业务。资源、义务、产出、可信事实与receipt按合同原子提交。
- 已执行迁移不可改；新增迁移编号/journal/schema/shared协议/组合根/lockfile/版本/架构策略有唯一写者。
- 模板/配方/发布内容与运行实例分离；发布内容不发资产，批量制造按工单/ordinal幂等产出。停用不删在途义务/历史定义。
- BaseId与CharacterId分开；独立基地simTime与墙钟分开。早期离线暂停，玩家快进不进入共享实时经济；前端帧率/轮询不决定收益。
- 地图/项目板/机器人todo消费同一真实计划；缺电/缺料/缺设备不能倒计时到点自动完成，文字不能反推规则。
- Jev只给有限选择/提案，执行前重验；普通调度/算术/验收是代码。模型网络在事务外，预算/超时/取消/迟到保护必需，不维持每机常驻大模型。
- 开发试玩可无邀请码/验证/强密码，但保留哈希/会话/CSRF/基地隔离与预算；普通账号无内容发布/资产补偿管理权。
- 内容/新手保持简单；不因为小说有某概念就先建复杂制度；不把新游戏写成西幻对象改名。
- 不增微服务、万能工作流/脚本平台或权威DuckDB。DuckDB若使用，只处理隔离分析导出；像素引擎不提前安装。
- 验证区分静态/mock/真PG/E2E/真人/真实模型。零测试、历史CI、lint=tsc不能伪作独立证据；无环境写NOT_RUN。
- 不修改allowlist/删失败测试掩盖问题；约束变更单列审查。游戏退役测试逐项说明保留/替换/移除理由。

运行命令参考CLAUDE.md与实际package.json，不沿用旧排期。DB脚本可能读取.env，先确认隔离测试源；不能操作未知生产数据。每次交付精确HEAD、API/文件变化、实际测试与回退。文档批准或测试通过都不是自动上线授权。
