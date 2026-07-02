# v0.7.1 迁移链说明

## 当前结论

- `0003` 到 `0012` 是手写迁移。
- `apps/server/drizzle/meta/` 只有 `0000` 到 `0002` 的 snapshot。
- `0012_npc_task_proposal.sql` 曾经存在于磁盘，但没有写入 `_journal.json`，干净库执行 `db:migrate` 时不会执行 `0012`。
- 因为 snapshot 停在 `0002`，当前 `pnpm --filter @ai-mud/server db:generate` 不可信，可能基于陈旧快照生成错误迁移。

## 已做的短期修复

- 已把 `0012_npc_task_proposal` 补入 `_journal.json`。
- 已新增 `apps/server/scripts/verify-migrations.ts`。
- 已新增 package script：

```bash
pnpm --filter @ai-mud/server db:verify-migrations
```

该脚本会：

1. 读取 `_journal.json`。
2. 校验 journal 中的 tag 与 `apps/server/drizzle/*.sql` 一一对应。
3. 基于 `DATABASE_URL` 在同一 Postgres 实例里创建临时空数据库。
4. 按 journal 顺序执行全部迁移 SQL。
5. 断言 `npc_tasks.proposal_source` 和 `npc_tasks.proposal_reason` 存在。
6. 删除临时数据库。

没有采用临时 schema 的原因：旧迁移里已经硬编码了 `public` schema 的 enum 和外键引用，用临时 schema 会得到不等价的验证结果。

## 后续重建 snapshot 的建议步骤

1. 准备一个一次性空 Postgres 数据库。
2. 执行 `pnpm --filter @ai-mud/server db:migrate`。
3. 用 Drizzle introspect 当前数据库结构。
4. 生成与当前 schema 对齐的新 snapshot。
5. 在 CI 中保留 `db:verify-migrations`，避免后续 SQL 文件和 journal 再次漂移。

在 snapshot 重建完成前，不要信任 `db:generate` 产出的迁移。
