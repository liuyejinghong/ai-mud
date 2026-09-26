# R1 验收证据索引

真浏览器截图（playwright landing-postgres 项目，真后端 + 一次性隔离 PostgreSQL）：

- `01-landing-first-view.png`：新档首访（U01）——固定工作区 1280×800：着陆器=已运行、
  安装位=空位、电力概览含应急 1.0 kW、目标条第 1 步。
- `02-project-started.png`：开工回执 + 队列卡（材料已预留）。
- `03-material-source-chain.png`：U03 缺料回路——扩建净缺口（结构件 需要 4 · 可用 0）
  → 准备材料 → 获取路径逐层（加工→冶炼→采矿，可点回矿点）。
- `04-after-refresh.png`：同档刷新后工程与队列保留（无离线收益）。

浏览器断言同时验证：根容器 scrollHeight − clientHeight ≤ 1（U02 固定工作区）；
页面零 pageerror。

教程 legacy 档 e2e（tutorial-postgres，预置 legacy 基地登录回归）另跑通过（截图在
runner 的 test-results，未入库存档）。真 PG 集成验收（G 系列）见
`apps/server/src/tests/base-operations/landing/landing.integration.test.ts`（9/9）。
