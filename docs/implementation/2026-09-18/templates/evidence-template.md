# <版本> 验收与交接

状态：DRAFT（填写真实数据，不保留虚构示例为结果）。

## 1. 绑定

- spec版本与路径：
- review时间：
- implementation head：
- base head / 前包报告：
- 工作树是否干净及差异：
- PRODUCT_VERSION与兼容版本（改前→改后）：
- 测试环境标签/机器/DB种类（不包含密钥）：

## 2. 任务与验收映射

| 任务ID | 实际修改文件/符号 | 验收ID | 原始证据路径 | 状态 |
|---|---|---|---|---|
| 待填 | 待填 | 待填 | 待填 | NOT_RUN |

状态仅允许PASS/FAIL/NOT_RUN/BLOCKED_EXTERNAL/REVIEWED。不得将REVIEWED等同运行PASS。

## 3. 命令结果

| exact command | head | exit code | 输出/日志位置 | 时间 | 说明 |
|---|---|---|---|---|---|
| 待填 | 待填 | 待填 | 待填 | 待填 | 尚未执行 |

## 4. 数据与恢复

实际迁移编号、已有活动兼容、新增表/索引、幂等字段、账本对账结果、世界重置范围、备份/恢复验证。只写实际执行步骤。哪些操作需要生产授权尚未执行。

## 5. 模型与费用（不涉及则N/A）

provider/SDK/model/prompt版本、dataset hash、split、真实外部调用数、cache数量、fallback/stale率、p50/p95/p99、input/output usage、总费用与UNKNOWN费用、预算上限。无真实调用则LIVE_MODEL=NOT_RUN，不填写猜测时延或官方广告数字为实测。

## 6. 真实玩家验证

人数、是否首次接触、场景、完成情况、卡点、观察原话、因果理解、继续动机、样本限制。无人试玩则PLAYTEST_PENDING，不由模型扮演玩家生成反馈。不要放无关个人资料。

## 7. 偏差与剩余问题

spec deviation及批准依据、已修/未修发现、影响、为什么不顺手扩范围。大项不能只写“后续优化”。

## 8. Verdict

ENGINEERING：PASS / CHANGES_REQUIRED / BLOCKED_EXTERNAL。
PLAYTEST：PASS / FAIL / PENDING / N/A。
LIVE_MODEL：PASS / FAIL / NOT_RUN / N/A。
RELEASE：READY / NOT_READY。

给出各结论依据，禁止从一项PASS推导全部PASS。下一包入口及必须先完成的前置项：
