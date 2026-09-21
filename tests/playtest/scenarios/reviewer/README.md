# 评审场景目录（reviewer/）

评审 agent 在这里新增或修改操作场景（`.spec.ts`）。提交 PR 后，`browser-review` 作业自动运行 `scenarios/` 下全部场景。

## 最小模板

见同目录 `example-touch.spec.ts`（已实际跑通）。要点：

1. 从 `../../fixtures/evidence` 导入 `test` / `expect` / `makePlaytestAccount`；
2. 用 `evidence.step("稳定步骤id", "操作意图", async () => { ... }, "实际操作")` 包住每个关键操作，
   前后页面状态、截图、网络与控制台日志会自动落盘；
3. 账号一律用 `makePlaytestAccount()` 现场创建（一次性、隔离、每轮新档）；
4. 业务结果不预设成功时，用 `evidence.note(key, value)` 记录观察，不要硬断言；
5. 只通过页面操作（点击/填写/滚动/键盘/刷新/等待）；直接调 API、写库、改 localStorage
   跳过玩法的做法不得作为 UI 操作替代。

## 只运行自己的场景

- 手动触发：Actions → browser-review → Run workflow → `scenario_grep` 填场景标题里的标识词。
- PR 触发时默认跑全部场景；临时缩小范围可在场景文件顶部用 `test.describe.configure` 或直接临时注释，
  但提交验收时请保留可完整运行的版本。

详细交接说明：`docs/playtests/browser-review-environment.md`。
