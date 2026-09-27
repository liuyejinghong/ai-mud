# Codex 独立验收第 1 轮：FIX_FIRST

2026-09-27；候选 af60bc4（产品代码树与 4b95552 一致）。没有合并或部署。Worker 的 build/类型/已有测试通过保留为工程证据；不接受“完整候选”的产品结论。

## 已执行的独立检查

读取完整 worker 结果、当前干净分支/提交、真实 E2E 内容、领域命令和实际 UI；查看首屏截图。新增 LandingShell.acceptance-review.test.tsx（MOCK UI 回归，原 fixture 复用、预期来自合同），四项检查全部失败。运行入口：apps/web 内 pnpm exec vitest run src/features/base/LandingShell.acceptance-review.test.tsx。完整日志 /private/tmp/yudian-r1-review/ui-review.log，测试副本在同目录。此次没有把静态截图或组件测试冒充浏览器全链。

## 必须修复

1. **教程由库存余额反推历史，推进后倒退/虚报就绪。** LandingShell.tsx deriveGoal 先检查 hasOre/hasMaterials 再检查已完成扩建；花完矿石后已完成的教程回第 3 步。任意一种结构件或线缆 >0 就写“两者已就绪”。独立测试两项失败。按已提交产出/工单/设施事实判历史；按具体扩建完整输入判准备状态；维护停机必须优先给恢复行动，不得被“去冶炼”盖住。

2. **选择两台筑垒后不能取消/换人。** NodePanel 的 disabled=busy||builderIds.length>=2 连已选项一起禁用。独立测试失败。达到上限仅禁用未选项；暂停后恢复需要让玩家真正选择替换设备，目前 LandingShellProps 的 onExtractionAction 只有 action 无替换参数，UI 无法完成已承诺操作。补点击级回归。

3. **缺料来源仍是文字而非行动闭环。** deriveSourceSteps 把 spare_part 当种子终点，已有本地备件配方也返回“当前版本无获取方式”，独立测试失败。recipe 步骤仅 span，不可进入对应生产；矿点点击后没有返回原工程的上下文栈。当前 E2E 反而断言“返回地图→选择一个对象”，与原工程保留相反。恢复原要求：来源按真实目录，所有相关缺料分支可操作、原目标/数量保留、返回正确；无来源不得编造。

4. **错误位置建造会破坏教程。** SitePanel 对每个空位列全部 buildableProjects，ConstructionService 只检查空闲，没有限制套件安装位置/扩建位种类；deriveGoal 却把太阳能是否建成硬绑定 install_solar。玩家能在 expand_a 上安装首太阳能，原位置仍空，首次安装又被 stableId 唯一性阻止，教程永远要求重装。统一语义：本方案的六个命名安装位和四个扩建位要在服务端验证合法模板，同时 UI 只显示该位置可行选项；增加真 PG 非法位置拒绝与正确位置完成回归。不可只靠前端隐藏。

5. **新命令缺控制租约，revision 检查先于幂等重放。** base-extraction/base-production 路由只验证账号 cookie/CSRF，composition 直接调用 service，没有 X-Base-Control-Token/有效租约验证。停用标签页可继续写，与03合同不符。ExtractionService、ProductionSlotService、PowerPolicyService 在读回执前先拒旧 revision；同命令成功后 tick 改 revision，再原样重发会失败而非返回原结果。保留鉴权/归属/有效控制验证；在有效主体/当前作用域内，已提交 identity 的重放不得被后续世界 revision 拒绝。新增真实 HTTP/PG 的旧token、缺token、重放跨tick检查；禁止只在业务内测试且省略 expectedRevision。

6. **电力策略没有按旧策略结清过去时间。** PowerPolicyService 直接 savePowerPolicy，注释明确写“下一基地分钟结清”，旧确认时段会按新策略分配。03合同要求先结清。复用当前基地已确认区间的结算参与能力；旧 B008 禁止的是任意请求推动全服/调用次数产收益，不是禁止合法的本基地时间边界结清。用受控测试时钟证明切换前后的能量不被追溯重算。

7. **FIFO 排队被擅自移除。** p-contract §6 宣称“单槽只绑一单，无服务端队列；FIFO=分槽”，这是与01/03合同不同的可玩行为，不是等价实现。恢复单槽排队/顺序、暂停让后续单运行、恢复与取消的预留语义；补两单预留、排队、暂停/继续、两槽共享能量测试。不得把测试改成“前单做完再下后单”规避要求。

8. **可见电力读数仍把峰值当实际。** LandingShell 顶栏显示 snapshot.power.generationWPeak 并写“发电”，夜间也不变；R1要求实际发电/负载/储电。使用结算同源的实际当期供电投影，应急与太阳能分清。增加夜间零太阳能、应急仍1kW和负载/储电变化的一致性样例。

9. **封装合同未完全落实。** 新 ExtractionService 从 world-runtime/resource-node.repository 导入 ResourceNodeRecord，属于 peer persistence 类型依赖。改用所有者公开值类型/已冻结结构端口，登记真实边界，不修改allowlist使违规合法化。

## 证据与范围缺口

- landing-real.spec.ts 共70行，只下首太阳能开工，没有恢复运行等待其自然完成，也没跑矿石→加工→维护→扩建。U04/U05 的真实浏览器路径未执行，真 PG 时钟探针不能“等价覆盖”浏览器可操作性。请正常 UI 完成三圈，保留首圈/替代路线、离开回访、720×450与真实200%缩放证据；这仍不是代签真人 PLAYTEST。
- 现有 PG “15批账本”断言终点光伏片仍12，没有真正完成首能源扩建；缺已采未送货取消、暂停后取消收尾、两基地隔离/并发、手工恢复、两加工槽和实体升级路径等05门槛。按 G 表补真实必要检查，不能仅凭已有9项自称G全覆盖。
- G13 无需生产数据权限：可在隔离 PG 先跑到0037，创建代表性的两个旧内容版本与在途义务，再应用0038，回读旧数据并完成义务；“无生产库权限”不能作为不做旧schema升级fixture的理由。

本轮属于第 1 次针对性返工。保留已正确完成的内容、迁移与功能，仅修复上述根因和缺失验收；不能删独立失败测试或把方案改成当前实现。完成后提供新 exact SHA、每条修复/验证映射、尚未测项。主控未修改产品源码。
