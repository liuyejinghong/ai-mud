# AI MUD 开发入口（架构3.0）

## 当前状态

当前默认任务是架构/模块化设计，非游戏开发。审查源码基线 `690cbc816051b30e323bb005c93c1396e1303c3c`，产品以shared/version.ts为准（0.10.6）。本PR只改设计文档和目标合同，尚未实现模块API、CI护栏或游戏功能。

先读：
1. `docs/implementation/2026-09-18/README.md`：唯一当前总控3.0。
2. `docs/architecture/project-constitution.md`：PC-01—16项目约束。
3. `docs/architecture/modularity.md` 与 `module-catalog.json`：模块归属、公开API和目标允许边。
4. `docs/architecture/target.md`：运行、事务、时钟、事实、AI、观察与部署语义。
5. `docs/architecture/2026-09-18-review.md`：源码发现与证据限制。
6. 经用户明确选定实施时，再读 `architecture-baseline.md`、`modularity-baseline.md` 和对应任务。

以上未带全路径的同名架构包位于 `docs/implementation/2026-09-18/`；module-catalog位于 `docs/architecture/`。原 `docs/architecture.md` 是现状说明，不得把其中未来能力或未验证保证当实现证据。

## 文档优先级

系统/用户本次明确要求 > 本文件与3.0总控的范围约束 > project-constitution/modularity/target（各管项目、模块、运行合同） > modularity-baseline对ARCH的明确增补 + architecture-baseline > 已重基线且明确选中的功能包 > 历史实现参考。

旧v0.11.0-foundation、v0.12—v1.1文件、00/01旧合同和旧implementation-prompt仍为REFERENCE_ONLY，不能凭文件中READY或旧F11编号开工。新版v0.11.0是架构收敛，MOD任务包含在其中，不是另一条并行路线。

## 必须遵守

- 没有实施授权，不修改源码、依赖、运行配置、数据库、产品版本或生产；不自动合并PR。
- 实施时只执行指定ARCH/MOD切片。顺序：ARCH-01→MOD-01→MOD-02→ARCH-02—08（逐项完成MOD-03）→ARCH-09→MOD-04→ARCH-10。
- 跨模块仅用登记public API；禁止peer internal/repo、裸SQL、万能service locator或本地HTTP绕行。公开type-only import也要遵守依赖图。
- 一事实一写所有者；共表按列约束。用例协调事务，UoW注入tx绑定模块API；platform不反向依赖业务模块，composition负责绑定。资产、义务、必要可信事实及收据原子提交。
- 关键一致性走同事务命令；非关键传播可用提交后事件。不能靠可丢事件完成付款/任务，也不能在事务里等待模型。
- 模型只给非权威选择/表达；Decision/Narrative分离。世界事实、原始玩家意图、模型判断不能混为一谈。
- 事实产生文案；Query只读；保留独立角色懒结算，不因重构删离线收益。
- 不在shared堆私有类型，不创建无调用者的未来模块，不用export *把internal全部公开。
- 新增/删除能力按change-spec模板说明归属、API、资产/义务生命周期与验收。边界策略/allowlist变更须单列审查，不由实现模型为了变绿自行放宽。
- `module-catalog.json` 是目标合同。MOD-02 已于 2026-09-18 交付并验证 `pnpm arch:check` 与 `pnpm arch:test`（实现位于 `scripts/architecture/`，规则由冻结的 catalog/boundaries/debt 三份 JSON 程序化推导，不得手工复制放宽）。存量违规以 `docs/architecture/legacy-boundary-debt.json` 为唯一豁免依据；新增违规 arch:check 立即失败，不得通过改台账/删测试变绿。无检查环境时缺验证仍写 NOT_RUN。
- 架构例外精确登记、限期移除，不自动批准新增违规。存档迁移不可静默丢数据，功能停用不得遗留无人处理的托管/预留。
- 不引入微服务、通用工作流/事件溯源/动态插件沙箱；Phaser像素仍DESIGN_ONLY，不因本次架构设计自动开工。

实跑命令参考CLAUDE.md/package.json，不把lint=tsc当两种独立证据；不把mock当PG/真实模型/真人试玩。启动与验收模板见 `docs/implementation/2026-09-18/templates/architecture-prompt.md`。
