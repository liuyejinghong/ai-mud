# 2026-09-25 修复批次 P 合同

状态：`CONTRACT_READY`（U/C/T 的现有前端合同）；M 保持只读调查，若需改公共投影须先补本合同。基线为本地 `main` 的 `041fe3f86278c85869ef5b47e06873fdb9d8750c`，产品 1.0.0，`schemaVersion=31`、`apiVersion=47`、`contentVersion=14`。远端 main 本轮因本机代理不可用未核实。当前实现分支为 `codex/review-remediation-20260925`，与原评审分支隔离。

## 玩家任务流

主入口显示目标、时间状态、地图和当前任务。选择建设位进入就地详情，条件、开工、项目状态与暂停恢复在同一任务区域。经营、制造、协作作为可返回的工作区；切换时保留所选对象及采购/制造输入，轮询不切换工作区或抢焦点。窄屏在地图与详情间显式返回，桌面并排展示。历史默认不占主场景。所有命令继续走现有 `BaseApp`/`baseApi`，不增加路由、计时器、请求或业务状态机。

## 现有数据与失败语义

- U/C/T 不新增 shared DTO、数据库字段、public API、版本号、依赖或允许边。读取现有 `BaseSnapshotDto` 的 `timeMode`、项目/工单状态、资源、协作请求和订单；不在客户端计算权威库存、ETA、成功条件或奖励。
- 命令处理中、成功回读和服务端错误显示在发起命令的工作区。快照刷新失败单独提示，不能把提交成功误写成已完成。暂停由 `timeMode` 判断；项目步骤的 `ready` 不代表正在计时。终态工单不提供取消，服务端拒绝仍保留。
- C 按 `requestId` 保留每条真实请求，只折叠历史呈现；不以相同文字合并不同请求、不删历史。后端重复意图先用隔离测试证明，再增补合同与唯一写者。
- M 先查库存/预留/在途的唯一事实、单位与消费者。字段和写路径未冻结前不得修改 DTO、资产或制造扣减；F04 的线上截图只证明解释缺口，不证明资产错误。

## 文件所有权

| 线 | 唯一可写源码/测试文件 |
|---|---|
| U | `BaseApp.tsx`、`BaseApp.test.tsx`、`BaseShell.tsx`、`BaseShell.test.tsx`、`BaseMap.tsx`、`BaseMap.test.tsx`、`ObjectPanel.tsx`、`ObjectPanel.test.tsx`、`ProjectBoard.tsx`、`ProjectBoard.test.tsx`、`base.css`（均在 `apps/web/src/features/base/`） |
| C | `apps/web/src/features/base/CooperationPanel.tsx`、`CooperationPanel.test.tsx` |
| T | `apps/web/src/features/base/BaseIntroModal.tsx`、`BaseIntroModal.test.tsx`、`ManufacturingBoard.tsx`、`ManufacturingBoard.test.tsx` |
| M | 本阶段只读，无源码写权；调查结论由 I 记入本目录 |
| Q | 独立验收证据，不改业务代码；若需新增测试，先指定精确文件 |
| I | 本目录与上级 `README.md` 的状态、证据和集成提交；共享源码变更先更新所有权表 |

U 唯一修改 `BaseShell` 的面板接线和 `base.css`，C/T 只改自己的组件并按现有 props 消费容器。各线使用独立 worktree；文件和分支所有者不能交叉写。`EconomyBoard` 的本地采购输入与 `ManufacturingBoard` 的本地数量须在工作区切换后留存；U 可通过保持组件挂载达成，无需改这两个组件。

## 共同样例与门槛

复用各组件已有的 `buildSnapshot` 测试工厂，不为这批内部视图另造跨包 fixture。至少覆盖：空项目和可建位；进行中的项目在暂停与恢复后显示正确说明；1200×800、1200×701、720×450 与长邮箱；53 条历史中含两个活动项目和阻塞请求；制造工单 `active/paused/blocked/completed/cancelled`；切工作区时已输入的采购/制造数量及所选建设位不丢。模拟数据不得注入线上存档。

U 按 A01–A04/A07，C 按 A05，T 按 A08/A09 验收；相关 A10 回归及 A12 身份检查由 I 记录。先运行相关 web 单测与 typecheck，再做隔离浏览器的视口/键盘/真实接线检查；真实 PG 与生产部署另列。若浏览器或数据库环境不可用写 `NOT_RUN`，不把静态推断、零测试或 mock 当真实玩法验收。

回退按 U/C/T 独立提交撤销前端变更，保留存档和资产；任何 M 的数据合同变更另列回退办法。本批不改物流/离线/节奏数值、不合并或上线。
