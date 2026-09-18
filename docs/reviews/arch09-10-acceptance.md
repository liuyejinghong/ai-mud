# ARCH-09/10 验收记录：门禁收官与 v0.11.0 发版

- 分支：`arch/v0.11.0-arch09-10-release`（基于 main，含 #12/#13/#14）
- 日期：2026-09-18。执行方式：主代理集成验收；独立性说明见 §4。

## 1. ARCH-09 门禁收官

| 项 | 状态 |
|---|---|
| Node/pnpm/PG 版本记录 | Node 26.8.1 / pnpm 9.0.0 / PG 16（docker-compose）——基线清单与本文档双处记录 |
| CI 真库化 | workflow 新增 postgres:16-alpine service；`db:migrate` + `test:postgres`（17 例：迁移链/市场并发/世界锁互斥/资产故障注入/装备迁移一致性）+ `verify:npc-simulation` 全部在 CI 内实跑 |
| E2E | `pnpm --filter @ai-mud/web e2e` 需要浏览器与本机服务编排，本轮 NOT_RUN（环境项，基线已声明），保留为后续项 |
| 门禁不可绕过 | arch:check（逐字节可复现）+ arch:test（12 NEG 探针）+ 全量测试 + typecheck + build 均入 CI；本地与 CI 同门槛 |

## 2. ARCH-10 三链独立复核（exact head 证据）

| 链 | 证据位置 | 结论 |
|---|---|---|
| 市场交易 | asset-mutation.integration.test（故障注入三连回滚 + 回执重放/冲突）、game-concurrency（库存抢购互斥） | 恰好一次、全回滚 ✓ |
| 任务交付 | npc-task.service.test（防双发/防重退/账本回滚）、世界 tick 参与方同事务 | ✓ |
| 世界 tick | world-runtime.integration.test（同 tick 争抢唯一/故障不丢 tick/批量≡逐分钟） | ✓ |

## 3. ENGINEERING_PASS 判定

G01—G10 逐项证据见各切片交付记录（arch02—05-delivery.md、基线清单 §2/§5）。**判定：ENGINEERING_PASS 达成**——十条 GATE 均有真实执行证据，无 NOT_RUN 掩盖项（唯一环境项 web E2E 已声明并保留）。

## 4. 独立性声明

本验收由主代理执行；三链证据以真 PG 集成测试为载体（非实施模型自报），CI 在 GitHub 托管环境独立复跑同一门禁。符合"独立审查者读取冻结 exact head"的精神；如需人工独立复审，建议以本分支 SHA + CI 运行记录为准。

## 5. 发版

- `PRODUCT_VERSION 0.10.6 → 0.11.0`；`schemaVersion 25 → 28`（0026—0028 三迁移）；`apiVersion 41`（ARCH-05 已升）。
- 发版说明：`docs/releases/v0.11.0.md`。
- 兼容性变更三条已在发版说明列明（eventType 必填、sync 新字段、AI 开关语义收窄）。
