# v0.11.0 模块化落地补充包

版本3.0；DESIGN_REVIEW，未实施，需用户明确指定开发。与 architecture-baseline.md 同属一个 v0.11.0，不增加一套产品版本，也不要求先建立所有未来模块。

## 1. 对2.0基线的精确增补

原ARCH任务的事务/时钟/装备/事实/观察/AI/恢复目标继续有效，新增下列顺序与封装约束：

`ARCH-01 → MOD-01 → MOD-02 → [ARCH-02—08，并在每项内完成MOD-03] → ARCH-09 → MOD-04 → ARCH-10`。

MOD-03是贯穿迁移的要求，不是再实施一次ARCH-02—08。只有当前指定批次可开工，不自动执行整条路线。MOD-02先有最小护栏；之后迁移一个真实链路就减少相应例外。

覆盖旧描述的具体差异：
- ARCH-03中资产helper的物理位置仅是原建议；现在以逻辑assets所有者/public能力为准，不要求所有新代码进ledger目录。
- 用例拥有事务语义，但仅获得UoW绑定的模块API，不持有裸SQL权限；数据库句柄只在platform和登记的模块persistence内部。
- GameService兼容门面可保留，但不得成为新的跨域实现堆积点。
- NPC/quests/economy跨域协调交给命名application用例，不得把peer repository或回调包装成“接口”绕过依赖图。
- 不用public.ts存在、类型检查通过或modules目录数量证明模块化完成。

## 2. MOD-01：冻结逻辑模块、文件归属与能力合同

读取：AGENTS、总控、project-constitution、modularity、module-catalog、target、ARCH-01清单及当前源码。已有设计的基线是690cbc8；执行时记录actual HEAD，额外变化需合并理解而非覆盖。

交付（实施时新增）：
- `docs/reviews/module-boundary-inventory.md`：模块→真实文件→公开能力→读写事实/列→依赖→消费者→对应ARCH迁移任务。
- `architecture/module-boundaries.json`：每个生产源文件的唯一归属规则、公开入口、bootstrap入口、层（public/domain/persistence/application/transport等），是检查器的实际输入。
- `architecture/legacy-boundary-debt.json`：确切已有违规，不自动批准任何新增违规。

要求：
1. 使用catalog中的逻辑ID，不批量更名所有文件。game.service当前包含多个未来所有者，先登记为legacy混合文件，列方法级迁移目标；不能整体宣称characters拥有其所有SQL。
2. shared按domain/protocol分区；content/rules/ai-prompts源文件分别归入适用纯层/ai适配。不得直接把所有shared export批准为kernel。
3. 现有NPC task/资源转移repository导入其他repository/服务的依赖属于要迁出的编排，不因在repository内部就合法。
4. 记录数据库共表的列归属、行初始化和删除责任；包含npc_tasks escrow、market quantity、角色/NPC铜币。列归属不等于今天新增一套wallet表。
5. 给当前确需调用的公开API定义输入、返回、错误、scope、query或tx-only、幂等和消费者；不设计没有调用者的功能。

验收M01：所有生产源文件可唯一分类；不能解析/归类的文件明确失败；新旧边与实际代码相符；catalog目标图无环；baseline例外每项带rule/source/target/symbol/修复任务/删除条件，经独立审查后冻结。

## 3. MOD-02：先实现能变红的边界检查

主要新增：`scripts/architecture/`中的薄检查入口与测试、`architecture/`上述输入；根package.json命令、锁定的开发依赖、必要CI配置。不修改游戏规则。

推荐使用固定版本dependency-cruiser解析实际TypeScript依赖图，读取真实tsconfig/路径别名；对source归属、公开入口和允许边生成规则。声明泄漏/数据库能力检查只补项目需要的薄检查。不要实现一个通用代码分析平台；不能仅用grep统计import行。

计划命令 `pnpm arch:check` 和 `pnpm arch:test` 必须在本任务创建后才可运行/列为已通过。`arch:check`返回结构化违反项+非零退出码；`arch:test`证明检查器识别坏代码。

必须覆盖：
- 相对路径、别名、扩展名解析、export-from/命名re-export、type-only import/export、静态dynamic import。
- 跨模块只命中登记public入口；bootstrap仅composition白名单；间接export不能带出内部repo、ORM类型或实现类。
- 已迁移模块无环，未列allow边失败；运行时注入的依赖也登记，不允许万能service locator。
- domain/pure层禁止DB、网络、Fastify、浏览器、直接系统时钟/Math.random；明确seed/clock注入。
- frontend禁止server/content秘密/模型密钥模块；provider层禁止world DB能力；transport不能通过app.di.db读写库。
- schema与DB库只在登记persistence/基础设施处可导入。对于允许共表访问，静态限制写字段子集；分析不了的raw SQL/动态字段进入精确审查清单，不能默认通过。
- 例外匹配rule+规范路径+符号/字段，不使用行号作为唯一身份；新增违规即使在legacy文件也失败。例外过期失败，新增宽泛豁免失败。
- 测试fixture明确分类，不给所有test文件跨模块无限访问；本模块白盒可读自身internal，跨模块集成只走public，存储集成fixture可用精确登记的setup helper。

红色探针最小集合：

| 编号 | 注入的违规 | 预期 |
|---|---|---|
| NEG-01 | npc import quests/internal/repository | deep import拒绝 |
| NEG-02 | npc通过alias/type-only绕过相同路径 | 同样拒绝 |
| NEG-03 | public命名或星号转出private ORM记录 | public泄漏拒绝 |
| NEG-04 | economy与npc出现直接/间接环 | 依赖/环拒绝 |
| NEG-05 | React导入server schema/provider | 前后端边界拒绝 |
| NEG-06 | provider通过平台或全局DI获取world repo | 能力边界拒绝 |
| NEG-07 | 角色仓储顺便更新copperBalance | 字段归属拒绝或明确进入必须人工确认的不可分析失败状态 |
| NEG-08 | 一个没归属的新生产文件 | fail closed |
| NEG-09 | 同一legacy文件添加第二个未登记跨域符号 | 新增违规拒绝 |
| NEG-10 | 增加modules/**豁免/动态非字面量import | 策略或加载方式拒绝 |
| NEG-11 | 纯规则调用Date.now/Math.random/fetch | 纯层拒绝 |
| NEG-12 | 使用局部API的正常消费/本模块白盒 | 正例通过 |

测试可以用隔离fixture工程执行检查器子进程并断言退出码，不把故意失败文件混进游戏构建。依赖解析、SQL扫描和runtime能力测试分别报告，不宣称静态扫描能证明任意JS程序不越权。

验收M02：正例通过、上述负例确实失败、真实库baseline报告可重复；过滤零测试不能算绿。catalog JSON和真实配置之间的允许边必须一致，不通过复制后手工放宽配置。

## 4. MOD-03：在ARCH每个切片内迁移真实依赖

| ARCH切片 | 必须收敛的模块能力 | 必须删除的旁路 |
|---|---|---|
| ARCH-02 | world进度/锁定API + npc结算参与API；application协调tick | world内部直接掌握所有NPC/经济逻辑，旧租约写路径 |
| ARCH-03 | assets事务能力；economy/quests/npc命令参与接口 | 每条玩法自写转账SQL；peer repo；raw tx外泄 |
| ARCH-04 | 统一装备实例读写与迁移接口 | legacy装备长期兜底及双写 |
| ARCH-05 | 明确结构化事实/公开类型 | 从中文文本反推数值、共享私有数据库记录 |
| ARCH-06 | characters结算、各域Query、observation聚合 | pure read暗中seed/结算/模型调用 |
| ARCH-07 | 单client_session与协议适配 | 第二份客户端资产状态、pixel/text各自轮询裁决 |
| ARCH-08 | ai公开Decision/Narrative调用及预算审计 | NPC绑定DeepSeek/Jev SDK；对话开关统治所有AI用途 |

先迁一条完整市场交易链，证明“用例→economy/assets公开API→同一事务→结果”成立，再按ARCH-03既定顺序迁任务、赠予、NPC消费等。仅增加转发文件而旧路径仍随处可用不算完成。

不要在一个改动中同时搬文件、修改规则数值、升级所有依赖和改SQL隔离级别。目录/接口迁移与必要正确性修复分提交，前后状态对照和故障证据均保留。

## 5. MOD-04：模块化验收，而非图形验收

放在ARCH-09之后、ARCH-10之前，由独立审查执行：

1. 可检查的事实归属及真实API调用已覆盖本轮所有生产路径；旧旁路例外清理。遗留非关键债务逐项披露，不伪造全仓零违规。
2. 用普通测试consumer仅依赖npc/public，可以替换合法决策结果而不import npc/ai内部；旧provider删除不会改变资产/战斗代码。
3. 用测试内容增加一个已有schema支持的物品/配方样例，不修改不相关模块内部；不新增真实玩法内容。
4. 验证任务完成跨quests/assets/npc的原子回滚，NPC和玩家市场操作共用同一报价/资产能力；数据一致不是靠同步事件碰巧及时消费。
5. 通过公开查询可生成同一事实的两个只读视图；不安装Phaser，不改变游戏时间尺度。
6. 演练一个测试模块/能力关闭：新请求明确拒绝、进行中义务有处理路径、预留不丢；这是fixture验证，不承诺在线插件热卸载。
7. 在确切提交运行边界/类型/规则/真PG/必要E2E；检查器自身负例仍能变红；配置/例外改动单列审查。

验收M04：通过上述证据才标 MODULAR_BASELINE_PASS；仅完成文档/图/接口定义只能标 DESIGN_APPROVED。branch protection本轮不自动修改；需要设置时单独授权，不能说文档PR已强制阻止合并。

## 6. 禁止的实现捷径

禁止为了满足catalog把所有跨域代码放进一个巨大application.ts；禁止把所有记录移动到shared；禁止输出一个public.ts但导出所有internal；禁止基于“都是同一个DB”放开SQL；禁止用异步事件替代关键事务；禁止用本地HTTP“实现解耦”；禁止为8个逻辑模块建立8套部署、数据库或独立发布管线。

最终目标是新增功能的影响面可预测、旧义务可回收、失败可定位。不存在任意新玩法零改底层的保证：新物理、真实多人碰撞、全局交易或第三方模组会触发新的明确ADR，而不是临时绕过这个合同。
