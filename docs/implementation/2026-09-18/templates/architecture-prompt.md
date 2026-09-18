# 架构阶段提示词3.0

## 1. 当前默认：设计审查

你正在审查AI MUD的模块化底层架构，不是执行玩法版本。
先读AGENTS和3.0总控，然后project-constitution、modularity、module-catalog、target、源码review、architecture-baseline和modularity-baseline。

对照actual HEAD，输出：事实与目标的差异、允许依赖是否可实现、数据归属/跨模块事务/世界时钟/事件回路/功能退出的未闭合点，以及必要的减法。特别检查“为了类型方便平台反向依赖所有业务”“public转出全部internal”“共表开放全部写权限”这类假模块化。

仅规划，不修改游戏源码/依赖/数据库/运行版本或调用真实模型；旧版本包不是开工授权。不要假装已经运行边界检查器/PG/真人测试。

## 2. 明确授权后的实施

本轮只执行用户指定的ARCH/MOD切片。顺序为ARCH-01→MOD-01→MOD-02→ARCH-02—08（逐项满足MOD-03）→ARCH-09→MOD-04→ARCH-10；不自动完成全路线。

先记录actual HEAD和工作树、确认当前计划已包含本PR3.0文档，再测试现状/不变量。每个切片给出真实文件与public API、权限/事务/失败测试，迁移真实调用并移除对应旧路径。一个聚焦任务一个提交，不同时改玩法数值和所有依赖。

模块间只用登记public接口；用例通过composition提供的UoW获得tx绑定模块API，不能拿raw tx；platform不反向import业务类型。跨模块反馈由命名用例/事件适配器组织，不能用任意回调或service locator隐藏循环。

不得修改catalog/allowlist/门槛来让自己的代码通过。确需改边界，另列Architecture Policy Change与最小证据，待独立确认。MOD-02检查器尚未创建前，不得把计划命令写成已存在；创建后必须证明负例能失败。不能解析的代码/SQL不得静默跳过。

无PG/浏览器/模型凭证标NOT_RUN，保留阻塞证据；不以mock替代。结束提交exact head、实际命令与测试数、PC/ARCH/MOD验收ID、剩余债务、删掉的旧路径与例外。不自动合并、不操作生产、不开始后续功能。

## 3. 独立验收

读取冻结head而非只读实现模型总结。逐条核对PC-01—16、ARCH-GATE和M01—M04。实走市场交易、NPC任务完成和world tick三条跨模块链：谁拥有事实、谁发起事务、是否穿透仓储/SQL、是否存在迟到/重试/权限/回滚缺口。

独立运行边界负例，确认alias/type-only/re-export/间接依赖不能绕过。检查实际注入依赖与catalog一致；static scanner不能证明的SQL/能力要明确标记人工审查及PG证据，不能假装完备形式验证。

审查一个内容扩展、一个provider替换和一个能力关闭的测试consumer，不要求上线新功能或引擎。拒绝空模块、万能协调器、通用工作流、把所有类型塞shared。明确列CONFIRMED/REQUIRES_TEST/DESIGN_TRADEOFF、未运行证据与未清债务。

工程完成不代表真人好玩、真实Jev有效或生产可发布。验收报告本身不授权自动上线。
