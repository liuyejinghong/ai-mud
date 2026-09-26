# 第 0 阶段上线与试玩服基地数据重置手册

日期：2026-09-25。适用对象：第 0 阶段完整性修复（B001/B005/B006/B008＋遗留世界退出 tick，车道合同见 `docs/implementation/2026-09-25-tutorial-version/phase0-lane-contract.md`）合入 `main` 之后的**首次**线上部署，以及随之进行的一次性基地数据重置。

- 重置脚本：`deploy/ops/reset-base-operations.sql`
- 真 PG 验收测试：`apps/server/src/tests/ops/reset-base-operations.integration.test.ts`
- 目标主机：SSH 别名 `aitrading-cp01`，仓库 `/opt/ai-mud`，compose 项目 `ai-mud`

## 0. 执行前提与授权边界

必须**全部**满足才可开始：

1. 第 0 阶段集成分支已按车道合同 §4 通过全量验证与独立验收，PR 已合入 `main`，CI 绿。
2. 用户明确下达了本次部署指令，并在上线前核对下述数据重置选择的原始授权。本手册、脚本及其测试通过**都不构成上线或执行重置的授权**（合同 §4：“线上部署另行授权”）。
3. 已在本地取得要部署的 `main` 完整提交号：`git ls-remote origin refs/heads/main`，记为 `EXPECTED_MAIN_SHA`。
4. 已提前通知试玩玩家：维护期间约 5—10 分钟不可用；维护后**所有人需要重新登录**，基地从头开始，账号和密码不变。

此前会话的手册记录（2026-09-25；原始授权待上线前核对）：“错误数据要重置，因为目前还是内测试玩。数据本身不重要。”——记录的处理范围是**重置全部基地经营实例数据、保留账号**，并吊销会话迫使重新登录。本轮仅授权继续开发，没有部署或执行 SQL 的指令。

| 类别 | 处理 | 内容 |
|---|---|---|
| 清空 | 删除全部行 | 16 张基地实例表：`bases`、`base_sites`、`base_control_leases`、`base_inventory`、`base_devices`、`robot_operators`、`base_power_state`、`base_projects`、`base_project_steps`、`base_manufacturing_jobs`、`base_manufacturing_outputs`、`decision_records`、`cooperation_requests`、`base_weather_schedule`、`base_orders`、`base_purchases` |
| 部分清除 | 删除基地命令收据 | `command_receipts` 中 `command_kind LIKE 'base.%'` 且 `actor_scope` 为 `base:{baseId}`，或 `account:{accountId}`＋`base.provision` |
| 吊销 | `revoked_at = now()`，保留行 | `sessions` 全部未吊销会话（含管理员） |
| 保留 | 不触碰 | 账号与管理员（`accounts`、`activation_codes`）、内容目录（`content_drafts`、`content_releases`）、`audit_logs`、`ai_call_logs`、`system_announcements`、世界时钟 `world_runtime_state`、旧西幻世界全部表、drizzle 迁移记录 |

逐表理由见附录 A。

## 红线（整个过程都适用）

- 同机还有其他项目。**只允许操作 compose 项目 `ai-mud`**（容器 `ai-mud-web-1`、`ai-mud-server-1`、`ai-mud-postgres-1`）。
- 所有 compose 命令都在 `/opt/ai-mud` 下执行，且一律带 `-f deploy/docker-compose.prod.yml`（项目名由该文件的 `name: ai-mud` 固定）。
- **禁止**：`docker system prune`、`docker image prune`、`docker container prune`、`docker volume prune`、`docker network prune`、`docker builder prune`、`docker compose down`（带 `-v` 会删除 `postgres_data` 数据卷）、`docker volume rm`、对非 `ai-mud-*` 容器的任何 stop/restart/rm、`docker restart $(docker ps -q)` 这类批量命令。
- **不打印任何密码**：不 `cat`/`less` `.env`，不 `docker inspect`，不 `docker exec … env`/`printenv`，不 `docker compose config`（会展开 `.env`）。数据库命令一律在 postgres 容器内用其自身的 `$POSTGRES_USER`/`$POSTGRES_DB`，并用单引号包住 `sh -c '…'`，让变量在容器内展开。
- 重置 SQL 只能在第 ⑥ 步执行，且必须先完成第 ② 步备份并通过 2.2 恢复演练。
- 任何一步结果与“预期”不符：**停下来**，保留现场输出，不要即兴修复（尤其不要 `git reset --hard`、手工删表、重复执行重置）。

## 会话变量

```bash
ssh aitrading-cp01
cd /opt/ai-mud
TS=$(date -u +%Y%m%dT%H%M%SZ); echo "TS=$TS"
EXPECTED_MAIN_SHA=<粘贴本次要部署的 main 完整提交号>
```

把 `TS` 的值记下来；SSH 断线重连后先 `cd /opt/ai-mud`，再用 `TS=<记下的值>`、`EXPECTED_MAIN_SHA=<…>` 重新设置。

---

## ① 预检

**1.1 容器状态，并给全部容器状态留档（只含名字与状态）**

```bash
docker compose -f deploy/docker-compose.prod.yml ps
mkdir -p /opt/ai-mud-backups && chmod 700 /opt/ai-mud-backups
docker ps --format '{{.Names}}\t{{.Status}}' | sort | tee /opt/ai-mud-backups/containers-before-$TS.txt
```

预期：compose 列出三个容器，`ai-mud-postgres-1` 为 `Up … (healthy)`，`ai-mud-server-1` 为 `Up`，`ai-mud-web-1` 为 `Up` 且端口 `0.0.0.0:8088->80/tcp`。留档文件里还能看到其他项目的容器，状态为 `Up`。

**1.2 健康检查**

```bash
curl -fsS http://127.0.0.1:8088/health; echo
```

预期：`{"ok":true,"service":"ai-mud-server"}`

**1.3 磁盘与数据库大小**

```bash
df -h / /var/lib/docker
docker exec ai-mud-postgres-1 sh -c 'psql -X -At -U "$POSTGRES_USER" -d "$POSTGRES_DB" -c "SELECT pg_size_pretty(pg_database_size(current_database()))"'
```

预期：可用空间建议 ≥ 5 GB（镜像重建约需 1—2 GB，备份约为库大小的几分之一）。低于 3 GB 时停下来，只清理 `/opt/ai-mud-backups` 中本项目自己的旧备份，**不要做全局 prune**。

**1.4 仓库状态**

```bash
git status --porcelain
git rev-parse --abbrev-ref HEAD
git rev-parse HEAD
```

预期：第一条**无输出**；分支 `codex/review-remediation-20260925`；HEAD `e64821a9c39773f7878376da8efbbae820e2f543`。`git status` 有输出时停止，先查明是谁改了什么（不要 stash/reset 丢弃）。

**1.5 基线计数（留档）**

```bash
docker exec -i ai-mud-postgres-1 sh -c 'psql -X -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$POSTGRES_DB"' <<'SQL' | tee /opt/ai-mud-backups/counts-before-$TS.txt
SELECT (SELECT count(*) FROM accounts) AS accounts,
       (SELECT count(*) FROM accounts WHERE role IN ('admin', 'super_admin')) AS admins,
       (SELECT count(*) FROM bases) AS bases,
       (SELECT count(*) FROM sessions WHERE revoked_at IS NULL AND expires_at > now()) AS live_sessions,
       (SELECT count(*) FROM content_releases) AS content_releases,
       (SELECT count(*) FROM audit_logs) AS audit_logs;
SQL
```

预期：一行数字，`admins ≥ 1`。服务仍在运行，玩家可能继续注册，**最终比对以第 6.2 步（停服后）的计数为准**。

## ② 备份

**2.1 pg_dump（自定义格式，已压缩）**

```bash
docker exec ai-mud-postgres-1 sh -c 'pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Fc -Z 6' > /opt/ai-mud-backups/ai_mud-pre-phase0-$TS.dump
echo "pg_dump exit=$?"
ls -lh /opt/ai-mud-backups/ai_mud-pre-phase0-$TS.dump
docker exec -i ai-mud-postgres-1 pg_restore -l < /opt/ai-mud-backups/ai_mud-pre-phase0-$TS.dump | grep -c 'TABLE DATA'
sha256sum /opt/ai-mud-backups/ai_mud-pre-phase0-$TS.dump | tee /opt/ai-mud-backups/ai_mud-pre-phase0-$TS.dump.sha256
chmod 600 /opt/ai-mud-backups/ai_mud-pre-phase0-$TS.dump*
```

预期：`pg_dump exit=0`；文件大小大于 0；`TABLE DATA` 计数约为 52（51 张业务表＋`drizzle.__drizzle_migrations`，以实际为准，绝不能是 0）；打印一行 sha256。注意这里的 `docker exec` **不能加 `-t`**（TTY 会损坏二进制输出）。

**2.2 恢复演练（必过，约 1 分钟；只在自建的临时库上操作）**

```bash
docker exec ai-mud-postgres-1 sh -c 'createdb -U "$POSTGRES_USER" ai_mud_restore_check'
docker exec -i ai-mud-postgres-1 sh -c 'pg_restore -U "$POSTGRES_USER" -d ai_mud_restore_check --no-owner --exit-on-error' < /opt/ai-mud-backups/ai_mud-pre-phase0-$TS.dump
echo "restore-check exit=$?"
docker exec -i ai-mud-postgres-1 sh -c 'psql -X -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d ai_mud_restore_check' <<'SQL'
SELECT (SELECT count(*) FROM accounts) AS accounts, (SELECT count(*) FROM bases) AS bases;
SQL
docker exec ai-mud-postgres-1 sh -c 'dropdb -U "$POSTGRES_USER" ai_mud_restore_check'
```

预期：`restore-check exit=0`；accounts/bases 与 1.5 一致（备份晚于 1.5，可能略多）；最后一条无输出。任一项不符即停止，不执行第 ⑥ 步。**只允许删除本步自建的 `ai_mud_restore_check`**，绝不能对 `ai_mud` 执行 `dropdb`。

**2.3 镜像留档（可选，用于快速回滚）**

```bash
docker image ls --format '{{.Repository}}:{{.Tag}}\t{{.ID}}' | grep '^ai-mud-'
docker tag ai-mud-server:latest ai-mud-server:pre-phase0-$TS
docker tag ai-mud-web:latest ai-mud-web:pre-phase0-$TS
```

预期：列出 `ai-mud-server:latest`、`ai-mud-web:latest`；两条 tag 命令无输出。镜像名与此不同就跳过本步（回滚仍可按 ⑧A 重建）。

## ③ 切到 main

```bash
git fetch origin
git checkout main
git pull --ff-only
test "$(git rev-parse HEAD)" = "$EXPECTED_MAIN_SHA" && echo "HEAD OK" || echo "HEAD MISMATCH"
git merge-base --is-ancestor e64821a9c39773f7878376da8efbbae820e2f543 HEAD && echo "contains e64821a"
test -f deploy/ops/reset-base-operations.sql && echo "reset sql present"
git diff --stat e64821a9c39773f7878376da8efbbae820e2f543..HEAD -- apps/server/drizzle
git diff e64821a9c39773f7878376da8efbbae820e2f543..HEAD -- deploy/docker-compose.prod.yml
git status --porcelain
```

预期：

- `git checkout main`：本地没有 main 时输出 `branch 'main' set up to track 'origin/main'` 与 `Switched to a new branch 'main'`；已有时输出 `Switched to branch 'main'`。
- `git pull --ff-only`：`Fast-forward …` 或 `Already up to date.`。若报 `Not possible to fast-forward`，**停止**，不要 merge/rebase/reset。
- `HEAD OK`、`contains e64821a`、`reset sql present` 三行都出现；出现 `HEAD MISMATCH` 则停止。
- 迁移差异：预期新增 `0036_phase0_integrity.sql` 及对应 journal 条目：增加 `cooperation_requests.resolution_reason`，并将 `base_power_state.dust_level` 从 `integer` 改为 `double precision`（`schemaVersion` 从 31 到 32）。如有其他迁移或差异不符，停止并由集成者核对；回滚时按 ⑧ 处理新 schema。
- compose 差异：只应出现带默认值的新环境变量（如车道 C 的旧世界开关，默认关闭）。若出现新的 `${VAR:?…}` 必填变量，停止并与集成者确认 `.env` 是否需要补充（不要打印 `.env`）。
- `git status --porcelain` 无输出。

## ④ 重建 ai-mud 三个容器

```bash
docker compose -f deploy/docker-compose.prod.yml up -d --build
```

预期：构建 `server`、`web` 镜像后输出类似：

```text
 ✔ Container ai-mud-postgres-1  Healthy
 ✔ Container ai-mud-server-1    Started
 ✔ Container ai-mud-web-1       Started
```

postgres 镜像未变不会重建，数据卷 `postgres_data` 保持不动。构建失败时旧容器继续运行旧版本、数据未动：按 ⑧A 切回 e64821a 即可。

## ⑤ 验证新版本（重置前）

server 容器启动时会先构建工作区包、再执行 `db:migrate`、最后启动服务（CMD 以 `&&` 串联，**迁移失败则服务不会启动**），约需 1—2 分钟。

```bash
for i in $(seq 1 60); do curl -fsS http://127.0.0.1:8088/health && echo && break; sleep 5; done
docker compose -f deploy/docker-compose.prod.yml ps
docker logs --since 15m ai-mud-server-1 2>&1 | grep -F 'migrations applied successfully'
docker exec ai-mud-postgres-1 sh -c 'psql -X -At -U "$POSTGRES_USER" -d "$POSTGRES_DB" -c "SELECT count(*) FROM drizzle.__drizzle_migrations"'
grep -c '"tag"' apps/server/drizzle/meta/_journal.json
docker logs --since 15m ai-mud-server-1 2>&1 | grep -E '"level":(50|60)|ERROR|Error:' | tail -20
curl -fsS -o /dev/null -w 'web %{http_code}\n' http://127.0.0.1:8088/
```

预期：

- 健康检查输出 `{"ok":true,"service":"ai-mud-server"}`（能返回即说明 `db:migrate` 已以 0 退出）。
- 三个容器均为 `Up`，postgres 为 `healthy`。
- 日志中有 `[✓] migrations applied successfully!`（drizzle-kit 输出，可能带颜色控制符；非 TTY 下若没有这一行，以下面两个数字为准）。
- 已应用迁移数与 journal 条目数**相等**（基线为 35，本次新增 `0036` 后预期均为 36）。
- 错误日志过滤**无输出**（Fastify JSON 日志 `"level":50` 为 error、`60` 为 fatal；`40` 为 warn，可接受）。
- `web 200`。

任一项不符：停止。确认 `0036` 未应用时可按 ⑧A 回滚代码；已应用或无法确认是否部分应用时，旧代码的积尘列仍按 `integer` 映射，按 ⑧B 评估恢复部署前的 schema 与数据。

## ⑥ 停 server → 执行重置 → 启动 server

**6.1 停 server（只停 server，web 与 postgres 保持运行）**

```bash
docker compose -f deploy/docker-compose.prod.yml stop server
docker compose -f deploy/docker-compose.prod.yml ps -a server
```

预期：`✔ Container ai-mud-server-1  Stopped`；状态为 `Exited (…)`（退出码 0/137/143 均可）。此后前端页面能打开，但接口返回 502，直到 6.5。

**6.2 重置前计数（服务已停，数值不再变化；留档）**

```bash
docker exec -i ai-mud-postgres-1 sh -c 'psql -X -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$POSTGRES_DB"' <<'SQL' | tee /opt/ai-mud-backups/counts-pre-reset-$TS.txt
SELECT (SELECT count(*) FROM accounts) AS accounts,
       (SELECT count(*) FROM accounts WHERE role IN ('admin', 'super_admin')) AS admins,
       (SELECT count(*) FROM bases) AS bases,
       (SELECT count(*) FROM sessions WHERE revoked_at IS NULL) AS unrevoked_sessions,
       (SELECT count(*) FROM command_receipts WHERE command_kind LIKE 'base.%') AS base_receipts,
       (SELECT count(*) FROM command_receipts) AS all_receipts;
SQL
```

**6.3 执行重置脚本**

```bash
docker exec -i ai-mud-postgres-1 sh -c 'psql -X -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$POSTGRES_DB"' < deploy/ops/reset-base-operations.sql
echo "reset exit=$?"
```

预期输出（逐行；`<n>` 为实际行数，右侧注释不会打印）：

```text
BEGIN
SET
DO
LOCK TABLE
DELETE <n>        -- base_manufacturing_outputs
DELETE <n>        -- cooperation_requests
DELETE <n>        -- decision_records
DELETE <n>        -- base_project_steps
DELETE <n>        -- base_projects
DELETE <n>        -- base_manufacturing_jobs
DELETE <n>        -- robot_operators
DELETE <n>        -- base_devices
DELETE <n>        -- base_inventory
DELETE <n>        -- base_power_state
DELETE <n>        -- base_weather_schedule（线上预期 0，见附录 C）
DELETE <n>        -- base_orders
DELETE <n>        -- base_purchases
DELETE <n>        -- base_control_leases
DELETE <n>        -- base_sites
DELETE <n>        -- bases：应等于 6.2 的 bases
DELETE <n>        -- 基地命令收据：应等于 6.2 的 base_receipts
UPDATE <n>        -- 吊销会话：应等于 6.2 的 unrevoked_sessions
DO
COMMIT
reset exit=0
```

失败时的表现与处理：

- 出现 `ERROR:  reset-base-operations: …`（schema 守卫或提交前自检）或其他 `ERROR`，且 `reset exit=3`（或其他非 0）：事务已**整体回滚，数据未变**。不要重试、不要手工删表；直接做 6.5 恢复服务，把完整输出交给开发判断。
- `ERROR:  canceling statement due to lock timeout`：server 没有停干净，回到 6.1 确认后再执行。
- 如果密码认证失败（`fe_sendauth: no password supplied`，官方镜像默认本地 socket 免密，一般不会出现）：把 `psql` 换成 `PGPASSWORD="$POSTGRES_PASSWORD" psql -h 127.0.0.1`，仍写在单引号 `sh -c '…'` 内，不要在宿主机展开密码。

**6.4 重置后核对（server 仍停止；留档）**

```bash
docker exec -i ai-mud-postgres-1 sh -c 'psql -X -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$POSTGRES_DB"' <<'SQL' | tee /opt/ai-mud-backups/counts-post-reset-$TS.txt
SELECT 'bases' AS t, count(*) AS n FROM bases
UNION ALL SELECT 'base_sites', count(*) FROM base_sites
UNION ALL SELECT 'base_control_leases', count(*) FROM base_control_leases
UNION ALL SELECT 'base_inventory', count(*) FROM base_inventory
UNION ALL SELECT 'base_devices', count(*) FROM base_devices
UNION ALL SELECT 'robot_operators', count(*) FROM robot_operators
UNION ALL SELECT 'base_power_state', count(*) FROM base_power_state
UNION ALL SELECT 'base_projects', count(*) FROM base_projects
UNION ALL SELECT 'base_project_steps', count(*) FROM base_project_steps
UNION ALL SELECT 'base_manufacturing_jobs', count(*) FROM base_manufacturing_jobs
UNION ALL SELECT 'base_manufacturing_outputs', count(*) FROM base_manufacturing_outputs
UNION ALL SELECT 'decision_records', count(*) FROM decision_records
UNION ALL SELECT 'cooperation_requests', count(*) FROM cooperation_requests
UNION ALL SELECT 'base_weather_schedule', count(*) FROM base_weather_schedule
UNION ALL SELECT 'base_orders', count(*) FROM base_orders
UNION ALL SELECT 'base_purchases', count(*) FROM base_purchases
UNION ALL SELECT 'base_receipts', count(*) FROM command_receipts WHERE command_kind LIKE 'base.%'
UNION ALL SELECT 'unrevoked_sessions', count(*) FROM sessions WHERE revoked_at IS NULL;
SELECT (SELECT count(*) FROM accounts) AS accounts,
       (SELECT count(*) FROM accounts WHERE role IN ('admin', 'super_admin')) AS admins,
       (SELECT count(*) FROM command_receipts) AS all_receipts;
SQL
```

预期：第一张表 18 行，`n` **全部为 0**；`accounts`、`admins` 与 6.2 **完全相同**；`all_receipts` = 6.2 的 `all_receipts − base_receipts`（剩下的是旧世界收据）。

**6.5 启动 server**

```bash
docker compose -f deploy/docker-compose.prod.yml start server
for i in $(seq 1 60); do curl -fsS http://127.0.0.1:8088/health && echo && break; sleep 5; done
```

预期：`✔ Container ai-mud-server-1  Started`，随后输出 `{"ok":true,"service":"ai-mud-server"}`。

## ⑦ 验证重置结果

**7.1 日志**

```bash
docker logs --since 5m ai-mud-server-1 2>&1 | grep -E '"level":(50|60)|ERROR|Error:' | tail -20
```

预期：无输出。

**7.2 一次性试玩账号注册，确认进入新基地**（与客户端序列相同：注册 → provision）

```bash
SMOKE_EMAIL="smoke-phase0-$TS@yudian.local"
SMOKE_PW="$(openssl rand -hex 16)"
JAR="$(mktemp)"
curl -fsS -c "$JAR" -H 'content-type: application/json' \
  -d "{\"email\":\"$SMOKE_EMAIL\",\"password\":\"$SMOKE_PW\"}" \
  http://127.0.0.1:8088/base/playtest-register > /tmp/smoke-register.json
echo "register exit=$?"
SMOKE_BASE=$(grep -o '"baseId":"[^"]*"' /tmp/smoke-register.json | cut -d'"' -f4)
CSRF=$(grep -o '"csrfToken":"[^"]*"' /tmp/smoke-register.json | cut -d'"' -f4)
echo "baseId=$SMOKE_BASE"
curl -fsS -b "$JAR" -H 'content-type: application/json' -H "x-csrf-token: $CSRF" -d '{}' http://127.0.0.1:8088/base/provision; echo
```

预期：`register exit=0`；`baseId=<uuid>`；provision 返回 `{"baseId":"<同一个 uuid>","duplicate":true}`（注册时已建好基地，客户端这次调用是幂等确认）。

**7.3 快照正常、是开局形态**

```bash
curl -fsS -b "$JAR" http://127.0.0.1:8088/base/snapshot > /tmp/smoke-snapshot.json; echo "snapshot exit=$?"
grep -o '"baseId":"[^"]*"' /tmp/smoke-snapshot.json
grep -o '"timeMode":"[a-z]*"' /tmp/smoke-snapshot.json
grep -o '"credits":[0-9]*' /tmp/smoke-snapshot.json
grep -o '"deviceId"' /tmp/smoke-snapshot.json | wc -l
grep -o '"reservationSources"' /tmp/smoke-snapshot.json | wc -l
grep -o '"projects":\[\]' /tmp/smoke-snapshot.json
```

预期：`snapshot exit=0`；baseId 与 7.2 相同；`"timeMode":"paused"`；`"credits":500`；设备 `12`（驮运 4＋工程 5＋巡检 3）；物资 `6` 种；`"projects":[]`。

**7.4 数据库侧**

```bash
docker exec -i ai-mud-postgres-1 sh -c 'psql -X -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$POSTGRES_DB"' <<'SQL'
SELECT (SELECT count(*) FROM accounts) AS accounts,
       (SELECT count(*) FROM bases) AS bases,
       (SELECT count(*) FROM base_devices) AS devices,
       (SELECT count(*) FROM robot_operators) AS operators;
SQL
```

预期：`accounts` = 6.2 的 `accounts + 1`（冒烟号；如期间已有新玩家注册会更多）；`bases` = 重置后已登录的账号数（至少 1，含冒烟号）；`devices = operators = 12 × bases`。

**7.5 浏览器人工确认**

- 用重置前已登录的浏览器刷新试玩服页面：应回到登录页（旧会话已吊销）。
- 用一个已有试玩账号登录：进入新的“先遣前哨”，开局引导弹窗会再次出现（按 baseId 记忆，属预期）。
- 管理员同样需要重新登录；管理台“内容工坊”里的草稿与发布版本仍在。

**7.6 确认其他项目未受影响**

```bash
docker ps --format '{{.Names}}\t{{.Status}}' | sort > /opt/ai-mud-backups/containers-after-$TS.txt
diff <(cut -f1 /opt/ai-mud-backups/containers-before-$TS.txt) <(cut -f1 /opt/ai-mud-backups/containers-after-$TS.txt) && echo "container set unchanged"
grep -v '^ai-mud-' /opt/ai-mud-backups/containers-after-$TS.txt
```

预期：`container set unchanged`；非 `ai-mud-` 容器仍为 `Up`，且 Up 时长比本次操作时长更长（说明没被重启）。

**7.7 冒烟号处置（可选）**

保留无害（无租约的基地会自动暂停）。如需停用：

```bash
docker exec -i -e SMOKE_EMAIL="$SMOKE_EMAIL" ai-mud-postgres-1 sh -c 'psql -X -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$POSTGRES_DB" -v smoke="$SMOKE_EMAIL"' <<'SQL'
BEGIN;
UPDATE sessions SET revoked_at = now()
 WHERE revoked_at IS NULL AND account_id = (SELECT id FROM accounts WHERE email = :'smoke');
UPDATE accounts SET status = 'disabled' WHERE email = :'smoke';
COMMIT;
SQL
rm -f "$JAR" /tmp/smoke-register.json /tmp/smoke-snapshot.json
```

预期：`BEGIN`、`UPDATE 1`、`UPDATE 1`、`COMMIT`。

完成后通知玩家“服务已恢复，请重新登录”；把 `TS`、`EXPECTED_MAIN_SHA`、6.2/6.3/6.4 输出与 7.2/7.3 结果记入本次发布记录。

## ⑧ 回滚方案

| 情况 | 做法 |
|---|---|
| ④/⑤ 失败（尚未重置） | 基地数据未重置；`0036` 未应用时按 ⑧A，已应用时按 ⑧B 评估恢复旧 schema 与数据（会丢失备份后的写入） |
| ⑥ 执行失败（`reset exit` 非 0） | 数据未动（整体回滚）；执行 6.5 恢复服务，由开发判断是否再次执行 |
| 重置成功，但新版本有问题 | `0036` 已应用，不能只按 ⑧A 回滚代码；若必须恢复旧版，按 ⑧B 评估恢复部署前的 schema 与数据（会丢失备份后的写入） |
| 必须找回重置前的基地数据 | ⑧B 从备份恢复（会丢失重置之后产生的全部数据：新基地、新注册账号、新会话），再按需 ⑧A |

**⑧A 代码回到 e64821a 并重建（仅确认 `0036` 未应用时）**

```bash
cd /opt/ai-mud
git checkout --detach e64821a9c39773f7878376da8efbbae820e2f543
git rev-parse HEAD
docker compose -f deploy/docker-compose.prod.yml up -d --build
for i in $(seq 1 60); do curl -fsS http://127.0.0.1:8088/health && echo && break; sleep 5; done
```

预期：HEAD 为 `e64821a9c39773f7878376da8efbbae820e2f543`；重建输出同 ④；健康检查正常。若做过 2.3 镜像留档，也可以不重建：`docker tag ai-mud-server:pre-phase0-$TS ai-mud-server:latest && docker tag ai-mud-web:pre-phase0-$TS ai-mud-web:latest && docker compose -f deploy/docker-compose.prod.yml up -d --no-build`（仍需先执行上面的 `git checkout`，保证仓库与运行版本一致）。`0036` 应用后，代码回滚不会撤销 schema；旧版仍按 `integer` 映射积尘列，健康检查不能证明读写兼容，不得单独执行 ⑧A。

**⑧B 从备份恢复数据（紧急操作）**

```bash
docker compose -f deploy/docker-compose.prod.yml stop server
sha256sum -c /opt/ai-mud-backups/ai_mud-pre-phase0-$TS.dump.sha256
docker exec ai-mud-postgres-1 sh -c 'pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Fc -Z 6' > /opt/ai-mud-backups/ai_mud-before-restore-$(date -u +%Y%m%dT%H%M%SZ).dump
echo "safety dump exit=$?"
docker exec -i ai-mud-postgres-1 sh -c 'pg_restore -U "$POSTGRES_USER" -d "$POSTGRES_DB" --clean --if-exists --no-owner --single-transaction --exit-on-error' < /opt/ai-mud-backups/ai_mud-pre-phase0-$TS.dump
echo "restore exit=$?"
docker exec -i ai-mud-postgres-1 sh -c 'psql -X -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$POSTGRES_DB"' <<'SQL'
SELECT (SELECT count(*) FROM accounts) AS accounts,
       (SELECT count(*) FROM bases) AS bases,
       (SELECT count(*) FROM sessions WHERE revoked_at IS NULL) AS unrevoked_sessions;
SQL
```

预期：`…dump: OK`；`safety dump exit=0`；`pg_restore` 成功时不输出任何内容、`restore exit=0`；计数与 1.5/2.2 一致（备份时刻的数据，旧会话恢复有效）。然后：备份的 schema 对应 e64821a，按 ⑧A 切回 e64821a 并 `up -d --build`；不要用含 `0036` 的新代码直接启动旧 schema。

`restore exit` 非 0：`--single-transaction` 保证库未被改动。`0036` 已应用时，`--clean` 可能留下备份中不存在的新对象；只有开发确认需要，且前面的 safety dump 已成功，才在开发在场的情况下执行 B2（重建空库后恢复）：

```bash
docker exec ai-mud-postgres-1 sh -c 'dropdb -U "$POSTGRES_USER" --force "$POSTGRES_DB" && createdb -U "$POSTGRES_USER" "$POSTGRES_DB"'
docker exec -i ai-mud-postgres-1 sh -c 'pg_restore -U "$POSTGRES_USER" -d "$POSTGRES_DB" --no-owner --exit-on-error' < /opt/ai-mud-backups/ai_mud-pre-phase0-$TS.dump
echo "restore exit=$?"
```

---

## 附录 A：逐表归属与理由（以 `apps/server/src/db/schema.ts` 与迁移 0029—0036 为准）

所有基地表的外键都是 `ON DELETE RESTRICT`，脚本按子→父顺序删除；`bases.account_id → accounts` 是基地指向账号，删基地不影响账号。

| 表 | 处理 | 外键 / 理由 |
|---|---|---|
| `bases` | 清空 | 基地根行；每账号至多一个（`account_id` 唯一），清空后 provision 才会新建 |
| `base_sites` | 清空 | → bases；建设位 |
| `base_control_leases` | 清空 | → bases；控制租约 |
| `base_inventory` | 清空 | → bases；基地物资 |
| `base_devices` | 清空 | → bases；唯一键 `(source_operation, device_def_id)`，provision 来源为 `provision:{accountId}:{模板}:{序号}`，不清空则同账号重新 provision 会撞唯一索引 |
| `robot_operators` | 清空 | → base_devices、bases；机器人作业者 |
| `base_power_state` | 清空 | → bases；电力与积尘 |
| `base_projects` / `base_project_steps` | 清空 | → bases、base_sites / → base_projects；工程与步骤 |
| `base_manufacturing_jobs` / `base_manufacturing_outputs` | 清空 | → bases / → jobs、base_devices、robot_operators；制造工单与逐台产出 |
| `cooperation_requests` | 清空 | → bases、base_projects；协作请求 |
| `decision_records` | 清空 | → bases（可空）；`purpose` 约束只允许 `transport_assistance`/`work_assignment` 两种基地协作用途，全表都是基地决策 |
| `base_weather_schedule` | 清空 | → bases；天气日程 |
| `base_orders` / `base_purchases` | 清空 | → bases；订单与采购（账款余额在 `bases.credits`，随基地清空） |
| `command_receipts` | 部分删除 | 无外键。基地命令（`base.createProject`、`base.cancelProject`、`base.createManufacturingJob`、`base.cancelManufacturingJob`、`base.acceptOrder`、`base.deliverOrder`、`base.purchase`）作用域为 `base:{baseId}`；`base.provision` 作用域为 `account:{accountId}`——provision 收据必须删，否则同 commandId 重放会返回已删除的旧 baseId。旧世界 `character:{id}` 的 `market.buy`/`market.sell` 保留 |
| `sessions` | 吊销（保留行） | 刷新页面走 `/auth/me` 恢复会话，不会触发 provision；只有重新登录后客户端才调用 `POST /base/provision` |
| `accounts`、`activation_codes` | 保留 | 账号、管理员、激活码 |
| `content_drafts`、`content_releases` | 保留 | 内容目录；模板与运行实例分离 |
| `audit_logs`、`ai_call_logs`、`system_announcements` | 保留 | 审计、AI 调用日志、公告（无指向基地的外键） |
| `world_runtime_state` | 保留 | 世界时钟与 tick 租约，基地结算由世界 tick 驱动 |
| 旧西幻世界表 | 保留 | `characters`、`character_*`、`chat_messages`、`item_*`、`asset_ledger`、`market_*`、`world_actors`、`world_resource_nodes`、`world_rumors`、`npc_*`、`municipal_treasury`、`map_instances`、`game_events`、`sync_events`（A0 §5：只关停不删除） |

脚本内置 schema 守卫：清单外若有表以外键引用清单内的表，或出现未登记的 `base_*` 表，整体拒绝并列出表名。以后新增基地表时，必须先更新脚本与测试清单。

## 附录 B：开发侧验证证据（2026-09-25，本地）

- 真 PG 集成测试（随机临时库＋全部迁移；两个账号经真实路由/结算产生工程、取消工程、制造工单与产出、订单、采购、协作请求、决策记录等全部 16 表数据）：
  `DATABASE_URL="$AI_MUD_TEST_DATABASE_URL" CI=true pnpm --filter @ai-mud/server test -- reset-base-operations` → 6/6 通过（变量指向隔离 PG 的测试库）。覆盖：清单覆盖 bases 的外键闭包与全部 `base_*` 表；守卫拒绝时零写入；重置后 16 表全空、基地收据清除、会话全部吊销（其余列不变）、其余全部表逐行指纹不变；再次执行零变更；旧 cookie 返回 401；同一账号重新登录后 provision 得到新 baseId，与新号的开局物资/设备/电力/建设位一致；管理员重新登录后草稿仍在。
- 在本地 `postgres:16-alpine` 容器里用与线上相同形式的命令（`docker exec -i … sh -c 'psql -X -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$POSTGRES_DB"' < deploy/ops/reset-base-operations.sql`）演练：首次执行输出 `BEGIN / SET / DO / LOCK TABLE / 17×DELETE / UPDATE / DO / COMMIT`，退出码 0；第二次全部为 `DELETE 0`、`UPDATE 0`，退出码 0；人为加一张引用 `bases` 的表后执行，输出 `ERROR:  reset-base-operations: 发现未登记的基地关联外键，拒绝执行：…`，退出码 3，基地行数不变。
- 备份命令演练：`pg_dump -Fc -Z 6` → `pg_restore -l` 可读（52 个 `TABLE DATA`）→ 执行重置 → `pg_restore --clean --if-exists --no-owner --single-transaction --exit-on-error` 恢复，基地、未吊销会话、迁移记录全部回到备份时刻；临时库恢复演练（2.2）通过。

## 附录 C：已知事项

- `base_weather_schedule` 在线上始终为空：`WeatherService.generateSchedule` 目前没有任何生产调用方（provision 不生成天气日程），天气按“晴”兜底。这是独立缺陷，另行立卡，不在本次范围；重置脚本照常清空该表。
- 管理员曾对某个基地执行过“激活发布版本”的，重置后新基地使用默认发布；`content_releases` 本身保留。
- 开局引导弹窗按 baseId 记在浏览器 localStorage，重置后会再次出现，属预期。
- 注册/登录频率限制在内存中，server 重启后清零。
