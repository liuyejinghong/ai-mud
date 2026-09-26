# R1 共同 fixtures

- 种子货单/机器人 profile/配方表/节点定义：`packages/content/src/base/landing-release.ts`
  （黄金断言：`landing-release.test.ts`，含"每项非初始必需材料至少一条可达来源"闭包检查）。
- 数值探针（P01–P05）：`apps/server/src/tests/base-operations/landing/landing-rules.probe.test.ts`。
- 真 PG 全链验收：`apps/server/src/tests/base-operations/landing/landing.integration.test.ts`。
- 真浏览器路径：`apps/web/e2e/landing-real.spec.ts`（playwright 项目 `landing-postgres`）。
- DTO/错误样例：`packages/shared/src/base.ts`（BaseActionBlockerDto 等结构化 blockers）；
  幂等/冲突/revision 负例见集成测试 G12 与 landing-rules 探针。
