# R1 当前验收证据索引

2026-09-27，主控独立验证。所有浏览器连接本机真实后端及一次性 PostgreSQL；使用正常 UI、正常 ×1/×4 与 60 秒世界 tick。控制租约负例单独以 HTTP 验证拒绝与阳性对照。未使用 SQL 发料、修改系统时钟或焦点伪装。

[当前结论](../takeover-status.md) · [各次 SHA、时间与工程门槛](verification/acceptance.json)

| 路径 | 关键证据 |
| --- | --- |
| 三圈经营 | [能源扩建终态](three-loops/13-circle-1-solar-expansion-complete.json)、[维护阻塞](three-loops/17-circle-2-exact-job-blocked-for-maintenance.json)、[原单恢复](three-loops/18-circle-2-same-job-resumed.json)、[第二加工间终态](three-loops/21-circle-3-processing-expansion-complete.json)、[最终画面](three-loops/21-circle-3-processing-expansion-complete.png) |
| 替代路线 | [同起始货单/天气及里程碑](alternate-route/route-summary.json)、[两加工槽终态](alternate-route/14-first-processing-expansion-complete.json) |
| 桌面与窄屏 | [1280×800](desktop-sizes/U02-1280x800.png)、[1440×900](desktop-sizes/U02-1440x900.png)、[720×450](desktop-sizes/01b-narrow-action.png) |
| 缺料导航与断网 | [来源链](source-network/U03-source-chain.png)、[真实勘探提交](source-network/U03-survey-submitted.json)、[断网提示](source-network/U08-offline-visible.png)、[联网恢复原上下文](source-network/U08-network-recovered.json) |
| 20 分钟回访 | [离开基线](revisit/U07-away-baseline.json)、[1201秒后](revisit/U07-after-20-minute-away.json)、[返回首次读](revisit/U07-first-return-read.json)、[原单最终完成](revisit/U07-returned-job-complete.json) |
| 低电恢复 | [低电阻塞](recovery/low-battery-stop.png)、[换设备恢复](recovery/low-battery-job-resumed-with-new-devices.json)、[同单送达40矿](recovery/low-battery-same-job-completed.json) |
| 零备件恢复 | [维护拒绝](recovery/zero-spare-maintenance-refused.png)、[手工备件产出](recovery/manual-spare-produced.json)、[原加工单完成及最终账目](recovery/same-job-resumed-after-manual-spare.json) |
| 原生200%及键盘 | [实测与方法](native-zoom/README.md)、[安装动作](native-zoom/U09-native-zoom-install-action.png)、[返回场景](native-zoom/U09-native-zoom-returned-to-scene.png) |
| 控制权拒绝 | [409/409/201](control-negative/http-results.json)、[拒绝画面](control-negative/01-negatives-rejected.png)、[有效租约受理](control-negative/02-valid-lease-accepted.png) |

三圈报告来源 `9852919`，回访 `0dce610`，恢复/桌面 `f7313cf`，控制负例 `f1c64d2`；全部产品源码均与 `b65281d` 一致。之后只有测试拆分、归属登记及文档归档。具体完整 SHA 与原始报告目录在 acceptance.json。三圈历史 U07 `NOT_RUN` 留存，不用它替代独立回访结果。

工程门槛：构建、类型、显式 E2E strict 类型检查通过；[架构检查](verification/delivery-arch-check.log) 0 uncovered、[12项架构自检](verification/delivery-arch-test.log)通过。完整1180项测试最终使用2个文件worker全部通过；同候选默认并发曾出现5秒超时及26项连锁失败，原日志保留在 `/private/tmp/yudian-r1-review/delivery-full-tests.log`，受控重跑为 `delivery-full-tests-bounded.log`。没有删除断言或加大超时。

复现本地受控回归：先核实一次性测试 PostgreSQL，再显式传入其 DATABASE_URL；执行 `CI=true pnpm -r run test --maxWorkers=2 --minWorkers=1`。浏览器用 `REAL_E2E_HEADED=true REAL_E2E_WORLD_TICK=true REAL_E2E_PROJECT=landing-postgres` 运行 `apps/server/scripts/run-real-player-e2e.ts`；运行前显式传入已核实隔离库的 DATABASE_URL，勿使用读取未知 .env 的旧入口。单项可用 REAL_E2E_GREP。每次新浏览器运行前归档 test-results（含 report.json）。

根目录原有四张截图与 takeover-short/narrow-window 保留为历史短路径证据；本轮以本索引的独立长路径和当前门槛为准。真人首访理解、恢复入口易发现性、30–45分钟体验节奏和可玩性均未代签；未进行合并、部署或生产存档操作。
