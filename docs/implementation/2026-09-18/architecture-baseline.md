# 架构基线包：v0.11.0（替代原 F11 开工包）

状态：DESIGN_REVIEW / 未实施。基线 `690cbc816051b30e323bb005c93c1396e1303c3c`，运行版本0.10.6。实施前置：用户明确接受本架构方向并指派ARCH批次。本文件不是开工授权。

## A. 完成定义与范围

保持当前可玩功能、主要规则数值、文本界面和部署形态；把现有路径迁到一致的权威/事务/事件边界。没有新NPC、关卡、补给任务、模型或像素客户端。架构缺陷修复是允许的，但经济定价/职业强度等规则变更移到v0.11.1或玩法包，不能用它们混淆重构对照。

实现采用现有modules及workspace。新增文件仅在明确拥有职责时创建；不用空目录、generic base class或通用CommandBus证明完成。不要求为了对称而给每个模块补routes/service/repository三件套。

## B. 固定技术与职责决定

参见 [target.md](../../architecture/target.md)。必须接受的最小集合：

- 单Node应用 + Fastify + Postgres/Drizzle，保留React/Vite；Node运行时单独锁定/验证。
- 世界runtime单事务tick互斥；角色按需结算保留且只有一个计算入口。
- 业务用例拥有tx，资产写方法加入tx；关键状态/账本/事实同事务。
- 装备目标真源item_instances；堆叠库存不强制合表。
- 事实生成文案，不能反向读取文案裁决。
- 私人探险/共享NPC市场的范围不偷偷更改。
- provider不能接触repo；Decision和Narrative分开，但不接新真实模型。
- HTTP先保留，协议、状态容器、renderer边界先明确。

## C. 任务顺序

| 批次 | 编号 | 内容 | 依赖 |
|---|---|---|---|
| 第一批：权威与事务 | ARCH-01 | 基线、状态归属与写入口清单 | 无 |
| 第一批 | ARCH-02 | 世界事务互斥、时钟、生命周期 | 01 |
| 第一批 | ARCH-03 | 统一tx/资产写边界与薄命令收据 | 01、02 |
| 第一批 | ARCH-04 | 装备唯一真源迁移 | 03 |
| 第二批：事实与观察 | ARCH-05 | 领域类型/结构化事件/可信里程碑 | 03、04 |
| 第二批 | ARCH-06 | 按需结算与只读观察职责分离 | 02、05 |
| 第二批 | ARCH-07 | 客户端会话与协议修订/重连规则 | 06 |
| 第三批：AI与验收 | ARCH-08 | 应用级AiGateway与两类能力接口 | 03、05、06 |
| 第三批 | ARCH-09 | 最小自动化验证、运行配置与恢复 | 02—08 |
| 第三批 | ARCH-10 | 独立验收和后续包重基线清单 | 09 |

每个任务一个聚焦提交；规模超过合理任务边界时按该任务内部子步骤拆提交，不越过依赖、不为并行加多个模型写同一数据库迁移。

### ARCH-01 基线冻结与路径清单

读取：AGENTS、CLAUDE、target、当前architecture；app/game/world-runtime/npc/task/dialogue/item/ledger/ai；shared/content/rules；web controller/sync/tutorial。记录exact HEAD与兼容版本，确认没有执行旧包。

交付 `docs/reviews/architecture-baseline-inventory.md`（实施时新增）：列出每个余额、堆叠物品、装备、任务、NPC行动、资源池、进度游标的真源、写路径、锁根、事务拥有者、事件/账本、当前测试。明确player map与world node是不同scope。

核对lockfile与实跑Node/pnpm/PG版本。先运行现有门槛，记录测试数量；已有失败不得通过删用例变绿。若真实分支有额外功能先报告与本基线差异，不把未知改动覆盖。

验收：AR-01—AR-08各有代码路径与对应ARCH任务；后续迁移清单由实际schema journal确定，不能机械假定所有下一迁移都叫0026。

### ARCH-02 世界推进与时间所有权

主要修改：`app.ts`、world-runtime service/repository/tests、NPC simulation tests、必要world-reset协作。可能新增 `modules/world-runtime/world-clock.ts`。

1. 注入Clock，分清调用真实时间与历史tickAt；保留60秒世界步长和有上限追赶，先不改NPC产量/工资节奏。
2. 启动时显式准备runtime行。每tick在同一tx先锁行，再读最新cursor，再结算NPC并保存进度。拿不到锁本轮skip；失败全部rollback。删除旧lease的权威路径，不允许旧saveProgress/releaseLease旁路存活；schema字段兼容移除另写迁移，不改旧SQL。
3. 请求/管理/timer共用唯一入口。post-tick只在有效推进后触发且不进入数据库事务；非关键文案可漏后补，关键经济状态不靠post-tick才完成。
4. lifecycle有停止接收、停止计时器、等待有界在途DB工作、取消外部请求、关闭连接的顺序。世界重置是维护操作，先排空写入，不提供未经设计的在线热重置。

验收：真PG两个调用竞争同tick仅一次效果；第一调用拿锁后抛错第二可继续；进度不倒退；重复时间零额外收益；短暂停机后批次追赶与连续运行在相同模拟边界内等价。测试应使用故障注入，不睡55秒冒充租约测试。不得声称数据库保护自动代表支持多副本生产部署。

### ARCH-03 显式事务、资产写能力和命令收据

主要修改：game service/repository、npc service/repository、npc-task、dialogue resource transfer、item、ledger、composition和真PG测试。新增 `modules/ledger/asset-mutation.service.ts` 或职责等价文件，保持现有ledger查询；新增薄command-receipt存储按项目命名。

顺序迁移真实调用：市场买卖 → 任务托管/完成/退还 → NPC赠予 → NPC买卖/工资/吃饭/维护 → 角色吃饭/维修/奖励。每迁移一类先补测试并移除旧资产SQL入口的调用，不能只创建一层包装却继续绕行。

合同：外层use case创建tx；内部写方法必须持有tx；同一事务内结算关联到期状态、锁定根、校验保留、转移物品和钱、写账、业务终态和必要事实。统一锁序覆盖整条调用链，不允许某处先锁角色、另一处先锁NPC却只在最后helper排序。

幂等：UNIQUE(actor scope, command kind, commandId, worldEpoch)，保存requestHash和结构化业务结果。重复相同请求返回原结果；相同key不同请求冲突。已有操作用稳定action/task事件标识去重，不在每次重试生成新的ID。拒绝不能留下部分资产写入；收据写失败必须连同业务回滚。

预留与余额分清；当前已存在的task escrow不能迁移成“只在内存标记”。尚未实现的维修券/借贷不在此任务添加。

验收：在扣减后、入账前、账本前、任务终态前、receipt保存前分别抛错，全部状态恢复；并发gift/task竞争不得突破保留；重复买卖不重复扣款；资产ledger与实际余额一致。静态边界测试禁止新旁路，但不能取代真PG故障测试。

### ARCH-04 结束装备双真源

主要修改：item service/repository、game repository/service、schema/migration、装备读写测试。保留堆叠表。

新角色装备直接用item_instances；旧角色装备按原ID/owner/slot/基础属性/耐久迁移，迁移前后快照对比；若ID与现存实例冲突不得静默覆盖。已有item_ledger建立明确migration baseline，不伪造成新掉落，不触发稀有广播/奖励/首次获得任务。

切换读写后停止character_equipment新写。可短期只读兼容仅服务迁移窗口，并列删除条件；不得跨release长期让两个模型互相兜底。数据不可无损恢复时回退用备份+旧版本，不承诺简单down migration恢复。

验收：新老角色同种装备在迁移前后战斗属性/耐久/装备槽一致；重复迁移不复制装备；换装/修理同一tx；已有正常存档不因重构丢失。

### ARCH-05 领域值、结构化事实与里程碑

主要修改：shared/domain与protocol划分、content/world、game-rules/combat、GameService事件构造、TutorialGuide、必要JSON payload迁移。

先在现有shared内部划分，不新建五六个包。领域Position等不依赖DTO命名和传输分页；兼容导出注明删除条件。

CombatTimeline从{atMs,message}改为带类型/参与者/数值的事实记录，文本formatter在投影边界。取消playerDamageFromCombatLog等对展示文案的数值反推；新手进度读取已提交里程碑或结构化事件，不读正则。

事实/公开通知/资产ledger各自职责明确。任务/履约记忆为关键业务事实，必须和对应终态同事务或具备已验证的可恢复桥接；本包默认同事务，不新增通用消息队列。旧纯文本记录仅显示，不自动升格成新的可信证据；必要旧存档适配使用明确版本，不静默猜测。

验收：替换中文formatter不改变战斗结果和里程碑；重复事实不重复增加履约信用；玩家“我已交矿”的对话不等于系统验证；相同seed/时间规则结果稳定。

### ARCH-06 单一角色结算与纯读投影

主要修改：GameService拆出CharacterSettlement与GameRead职责（可先同module多文件）、game.routes/composition、admin NPC读取、offline report入口。

先提取现有settleReadableState及相关计算，保留一次且只一次的实现。调用者传入tx和now；进食、交易等操作需要的到期结算也走同一入口。

外层sync use case允许“推进本人→读一致快照”，对外无需马上新增多个HTTP请求。独立read模型禁止seed、写角色/资产和等待模型；明确读取快照隔离语义。后台世界不因每个玩家读state而重复推进。初始离线简报先返回缓存/模板；可选模型生成不阻塞核心快照。

验收：只调用pure read数据库业务行不变；不同轮询频率/重登间隔不会改变总奖励；model关闭或超时不阻塞角色与世界推进；admin看面板不偷偷创建新世界。切勿直接删除懒结算。

### ARCH-07 同步协议与客户端单一状态

主要修改：shared protocol、game sync/read、gameApi、useGameSync/useGameController、必要schema revision/epoch字段。

区分cursor（传输进度）、revision（领域状态）、epoch（世界世代）。至少角色根revision与实际角色相关命令同事务递增；市场/NPC读模型不得借用角色revision假装全局版本。旧完整stateVersion字段按明确版本兼容，不让客户端同时比较两套语义。

可继续轮询和低规模完整快照；sync_events是通知/失效提示，不是完整重建世界的唯一日志。断线、游标过期、漏通知靠权威快照收敛。必须可靠保留的个人任务通知从业务持久状态呈现，不因事件分页遗漏而永远丢失。

一个客户端session状态管理命令与poll响应；拒绝不同epoch旧状态及较低同领域revision覆盖，不能仅以网络请求编号判断新旧。观察只输出玩家可见事实，不把NPC内部记忆和其他玩家对话全发给浏览器。

验收：人为交换两个响应到达顺序、100条以上事件分页、落后游标、重连、世界重置、私人数据隔离；无React的协议测试也能读相同事实。不开WebSocket，不安装renderer。

### ARCH-08 AI接口与调用治理

主要修改：ai provider/orchestrator/policy、game composition、dialogue/task/memory/rumor调用边界、config、相关测试。允许在同modules/ai新增gateway及decision/narrative小接口。

先把现有文本能力包成NarrativeProvider，再定义纯规则DecisionProvider作测试替身。只建立能力边界，不把NPC日常目标切换成新玩法、不接Jev真实网络。

应用级共享AiGateway负责所有purpose独立开关/超时/预算预留/并发准入/日志；不再用AI_NPC_DIALOGUE_ENABLED隐式控制全部用途。保留旧配置的显式映射和告警，不无声改变所有调用的默认开启状态。

使用mock provider验证选择器只能返本次候选；事务外调用后必须epoch与前提复核；fallback提交后迟到结果丢弃；关闭AI仍保留可信关系/记忆。预算预留并发测试；超时未知是否计费不得当成免费重试。生成理由/概率不是事实、不是NPC好感度。

验收：禁用一个purpose不误关其他purpose；新增purpose遗漏policy/fallback/logging使测试失败；provider无Db权限；所有网络在tx外；无密钥全游戏路径继续通过。

### ARCH-09 基础运行与自动化门禁

锁定并记录运行Node/pnpm/PG/lockfile；建议Node24 LTS兼容验证单独提交，Node22临时保留也必须有明确支持/迁移理由。不要把Fastify/Drizzle/React/Vite所有major升级混入重构。

添加或补齐CI实际执行test/typecheck/build、真PG迁移/并发、关键E2E；核查package script，test过滤空集合不能通过，lint=tsc如实说明。测试前验证目标DB是隔离环境，不读取/打印真key。

最低部署合同：静态Web、单应用、PG；同源HTTPS反向代理规划、DB不公网、配置检查、readiness与liveness区别、有界shutdown、备份恢复演练步骤。没有负载测量不得写“已支持1000 NPC/10000玩家”。

基线已有命令（实际执行前再次核对）：
```bash
CI=true pnpm -r test
CI=true pnpm -r typecheck
CI=true pnpm -r lint
CI=true pnpm -r build
pnpm db:verify-migrations
pnpm test:postgres
pnpm --filter @ai-mud/web e2e
pnpm verify:npc-simulation
git diff --check
```

PG/仿真命令只针对隔离测试库。新增测试可能需要更新现有脚本显式收集，不能假定文件名含integration就会被自动包含。世界重置验证须另行确认隔离目标。

### ARCH-10 独立验收、版本与后续迁移

独立审查者读取冻结exact head及证据，不接受实施模型自报“所有通过”。核查三条完整链：市场交易、任务交付、世界tick；再看AI失败与客户端重连。抽查新旧SQL写入口是否真的退出，是否有空接口/两套scheduler/两套asset服务。

ENGINEERING_PASS需下表全部通过。全量通过后更新PRODUCT_VERSION=0.11.0，按实际变化bump兼容子版本，迁移按journal实际编号。提交中文发布说明，列明未做的玩法/模型/2D。

后续包只交付rebase清单：旧F11哪些数值修正移v0.11.1；v0.12调用新资产/事件的映射；v0.13复用新provider；v0.15删除重复基础设施。下一包仍需独立开工指令。不要在本ARCH任务中偷偷完成补给任务。

## D. ARCH-GATE 验收矩阵

| ID | 必须提供的证据 | 不可接受的替代 |
|---|---|---|
| G01 | 真PG并发同tick一次效果、异常回滚、进度不倒退 | 只有内存lease fake |
| G02 | 资产/业务状态/账本/收据在多故障点共同回滚 | 只校验返回HTTP 200 |
| G03 | 命令重复、payload冲突、并发消费与保留不突破 | 仅客户端禁用按钮 |
| G04 | 装备迁移前后属性/耐久/所有权不变，无新掉落 | 清库重seed |
| G05 | 不同文案相同规则结果，里程碑不依赖regex | 仅改函数命名 |
| G06 | 纯读零业务写；按需与连续结算的等价用例 | 删除离线结算 |
| G07 | 乱序/重连/分页/epoch及私人信息隔离 | 单次顺序happy path |
| G08 | 网络在tx外、provider关/超时、预算竞争和迟到响应测试 | 真实API调用一次成功 |
| G09 | 基线脚本真实跑到测试、已知失败未被删除掩盖 | passWithNoTests空通过 |
| G10 | 无新玩法/引擎/数据库平台；独立审查与exact head | 图变漂亮或LOC下降 |

## E. 证据与回退

每任务报告：head、diff范围、对应AR/ADR、测试名/命令/数量/结果、NOT_RUN及原因、migration与恢复、被删除的旧路径、保留兼容的截止条件。无数据库/浏览器时可以交代码供审，但相应GATE保持BLOCKED。

纯重构可回退代码；已改schema/装备数据必须按迁移兼容/备份恢复方案操作，不默认down安全。禁止为方便回退长期双写两套事实。所有生产操作另需授权。
