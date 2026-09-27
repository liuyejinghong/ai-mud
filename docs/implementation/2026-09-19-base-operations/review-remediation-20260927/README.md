# 评审整改 20260927：v1.0.3 状态如实化与反馈就地化

日期：2026-09-27。分支 `fix/design-review-20260927`（基线 6450692 / v1.0.2）。来源：里程碑评审 run `yudian-gdr-20260927-v102`（报告包在评审机 `~/.yudian-review/runs/yudian-gdr-20260927-v102/`，findings D010–D025＋D001 残余）。本批经用户授权实施；**未授权合并/发版**。

## 修复范围（P1 全部＋P2 快赢；D011 低风险改善；D012 仅动默认倍速杆）

| 发现 | 修复 | 主要落点 |
|---|---|---|
| D010 冻结谎报运行中/幽灵租约 | 推进闸门确认边界改租约有效性；TTL 清扫挂世界 tick；409 带 GHOST_LEASE/HEARTBEAT_STALE；快照新增 effectiveRunning/pauseReason；UI 如实显示＋接管原因可见＋矛盾措辞清除 | world-runtime、shared/base.ts、web runtimeState |
| D013 事件不可回看 | 迁移 0040 建 base_events（手写 SQL＋journal）；工程/制造/采矿/订单四结算点同事务写入；GET /api/base/events；web EventsPanel（失败优雅降级） | base-event.repository、base-events 用例、EventsPanel |
| D014 条件反馈错位 | 维护前置提示进动作现场；条件不满足按钮就地禁用＋现场原因 | web 队列卡/表单 |
| D015 配方级缺料无路径 | 配方行"可用 N/缺 M"＋复用项目级 SourceChain；仓库零量名目显示；地图"前往加工" | ManufacturingBoard 等 |
| D012 首圈 79 分钟超诺 | 新档初始倍速 ×1→×2（最小杆；内容级压缩另行提案） | base.service provision |
| D016/D017/D018/D020/D021/D022/D023/D024/D025 | 面板滚动可供性、返回保留展开态、Tab 序＋toast 消隐、时钟命令串行化、充电实测口径、订单/采购 createdAt＋旧档展示、术语统一、收益行、aria-pressed | web 各面板；server DTO |

明确不修：D011 成因定案（待真人浏览器复测，但已做时钟插值＋轮询去阻塞）；D019（丢单未复现）；D003（像素期）。

## 根因记录（黑盒评审反推→源码证实）

- **D010 核心**：`lockAdvanceableBases` 的确认边界跟随 `lease.updated_at`（最后续租点）而非租约有效性；`acquire` 把 `updated_at` 与 `last_advanced_at` 推到同一时刻后，到期清单的严格大于谓词恒假——续租停摆即永久冻结在 running 态；暂停/恢复能唤醒只因命令事务先刷租约。修复后：有效租约确认到 min(tick, wallNow)，过期确认到 updated_at；`sweepExpiredLeases` 先结清后释放。
- 语义权衡：心跳断档宽限从"~即时停"放宽到 TTL 上限（≤120s 墙钟）——"有效租约=前台凭证"的直接推论；如需收紧有备选（见 A 线报告）。

## 验证

- 集成分支全量：typecheck 全绿；server 778 passed/0 failed/6 skipped＋tutorial 文件在 ai_mud_ci 环境单独 6/6；web 259/259；shared/content/game-rules/ai-prompts 全过；`node scripts/architecture/arch-check.mjs` PASS（新文件 8＋5 条已登记 module-boundaries.json）。
- 契约对齐核验：事件端点五字段、effectiveRunning/pauseReason 字段名逐字一致（web 侧保留缺失回退语义）。
- Q 独立验收：本地真栈按回归卡 EXP-102-01/03/04/05 验证＋EXP-102-02 杠杆（默认 ×2），结果见评审包 Q-ACCEPTANCE.md。
- 未做：真人浏览器（D011 定案）、×1 全链 45 分钟实测（EXP-102-02 主体）——上线后按回归卡补。

## 版本

PRODUCT_VERSION 1.0.3；schemaVersion 35（迁移 0040）；apiVersion 52（事件端点＋快照字段）。
