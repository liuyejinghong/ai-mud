# 数据库配置与部署

## 本地开发机

本地开发使用仓库根目录的 `docker-compose.yml` 启动 Postgres，服务只绑定到 `127.0.0.1:55432`，不会暴露到局域网，也不会抢占机器上已有的默认 Postgres 端口。

```bash
pnpm db:up
pnpm db:migrate
pnpm test:postgres
```

默认本地连接串：

```text
DATABASE_URL=postgres://ai_mud:ai_mud_dev_password@127.0.0.1:55432/ai_mud
```

根目录 `.env` 是本机私有配置，不提交到 git。`.env.example` 只保存可复制的开发默认值，不保存真实服务器密码或 AI API key。

## 服务器部署

服务器部署时不要改代码，也不要沿用开发密码。只需要在服务器环境里设置真实的 `DATABASE_URL`：

```text
DATABASE_URL=postgres://<user>:<password>@<postgres-host>:5432/<database>
```

推荐约束：

- 数据库和应用服务器可以先部署在同一台机器，但 Postgres 端口默认只对内网或本机开放。
- 生产密码、`SESSION_SECRET`、`DEEPSEEK_API_KEY` 只放在服务器环境变量或部署平台 secret 中，不写入仓库。
- 正式迁移前先在临时空库执行 `pnpm --filter @ai-mud/server db:verify-migrations`。
- 每次正式版本发布前执行 `pnpm --filter @ai-mud/server db:migrate`，再启动应用进程。
- 生产库必须配置每日备份；世界重置功能不能替代数据库备份。

## 环境边界

- `DATABASE_URL` 决定连接哪个 Postgres。
- `docker-compose.yml` 只服务本地开发和测试，不是生产部署模板。
- 未来迁移到服务器时，代码仍读取同一个 `DATABASE_URL`，因此不会出现“开发机写死地址导致服务器不可用”的问题。
