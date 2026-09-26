-- ============================================================================
-- 《余电》试玩服：重置全部基地经营实例数据（保留账号），并吊销全部会话。
--
-- 授权：2026-09-25 用户确认内测数据不重要，第 0 阶段修复上线后重置基地经营数据、保留账号。
-- 操作手册：docs/deployment/phase0-deploy-and-reset.md（第 ⑥ 步）。
--
-- 执行（先停 server 容器，只在 ai-mud 的 postgres 容器内执行）：
--   docker exec -i ai-mud-postgres-1 sh -c \
--     'psql -X -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$POSTGRES_DB"' \
--     < deploy/ops/reset-base-operations.sql
--
-- 性质：
--   * 单事务（BEGIN … COMMIT）：任一语句失败整体回滚；psql 配合 ON_ERROR_STOP=1 以退出码 3 结束。
--   * 幂等：重复执行成功，只会得到 DELETE 0 / UPDATE 0。
--   * 只 DELETE / UPDATE 行：不 DROP、不 TRUNCATE、不改 schema、不重置序列。
--   * 守卫：若库里出现本脚本未登记的基地关联表（引用下列任一表的外键，或新的 base_* 表），
--     整体拒绝执行并列出表名——先按 apps/server/src/db/schema.ts 复核归属再更新本脚本。
--
-- 清空（16 张基地实例表，全部行；依据 schema.ts 与迁移 0029—0035 的外键逐表核对）：
--   bases                        基地根行（account_id → accounts，账号保留）
--   base_sites                   建设位（→ bases）
--   base_control_leases          基地控制租约（→ bases）
--   base_inventory               基地物资（→ bases）
--   base_devices                 设备资产（→ bases）；唯一键含 provision:{accountId}:… 来源，
--                                不清空则同账号重新 provision 会撞唯一索引
--   robot_operators              机器人作业者（→ base_devices, bases）
--   base_power_state             基地电力（→ bases）
--   base_projects                工程（→ bases, base_sites）
--   base_project_steps           工程步骤（→ base_projects）
--   base_manufacturing_jobs      制造工单（→ bases）
--   base_manufacturing_outputs   制造逐台产出（→ jobs, base_devices, robot_operators）
--   decision_records             协作决策记录（→ bases；purpose 约束只允许基地协作用途）
--   cooperation_requests         跨组协作请求（→ bases, base_projects）
--   base_weather_schedule        基地天气日程（→ bases）
--   base_orders                  外部订单（→ bases）
--   base_purchases               采购在途（→ bases）
--
-- 部分处理：
--   command_receipts   只删基地命令收据：command_kind 以 'base.' 开头，且
--                      actor_scope = 'base:{baseId}'（工程/制造/订单/采购命令），或
--                      actor_scope = 'account:{accountId}' 且 command_kind = 'base.provision'。
--                      provision 收据必须删：否则同 commandId 重放会返回已删除的旧 baseId。
--                      旧西幻世界收据（character:{id} / market.buy|market.sell）保留。
--   sessions           吊销全部未吊销会话（revoked_at = now()，保留行）：刷新页面恢复会话
--                      不会触发 provision，必须迫使玩家重新登录，登录后客户端调用
--                      POST /base/provision 为无基地账号新建基地。
--
-- 保留（不触碰）：
--   accounts、activation_codes            账号与管理员（含 role/status/密码哈希）
--   content_drafts、content_releases      内容目录（模板/发布与运行实例分离）
--   audit_logs                            审计记录
--   ai_call_logs                          AI 调用日志
--   system_announcements                  系统公告
--   world_runtime_state                   世界时钟与 tick 租约（基地 tick 由其驱动）
--   旧西幻世界全部表（characters、character_*、item_*、asset_ledger、market_*、world_*、
--   npc_*、municipal_treasury、map_instances、game_events、chat_messages、sync_events 等）
--   drizzle 迁移记录（drizzle schema）
-- ============================================================================

BEGIN;

-- 服务未停时不无限等锁：拿不到锁 10 秒即失败回滚（先停 server 再执行）。
SET LOCAL lock_timeout = '10s';

-- ---------------------------------------------------------------------------
-- 0. schema 守卫：清单内的表必须都在；清单外不得有表引用清单内的表；不得有未登记的 base_* 表。
-- ---------------------------------------------------------------------------
DO $guard$
DECLARE
  cleared constant text[] := ARRAY[
    'bases', 'base_sites', 'base_control_leases', 'base_inventory', 'base_devices',
    'robot_operators', 'base_power_state', 'base_projects', 'base_project_steps',
    'base_manufacturing_jobs', 'base_manufacturing_outputs', 'decision_records',
    'cooperation_requests', 'base_weather_schedule', 'base_orders', 'base_purchases'
  ];
  missing text;
  stray_fk text;
  stray_table text;
BEGIN
  SELECT string_agg(t, ', ' ORDER BY t) INTO missing
    FROM unnest(cleared) AS t
   WHERE to_regclass(format('public.%I', t)) IS NULL;
  IF missing IS NOT NULL THEN
    RAISE EXCEPTION 'reset-base-operations: 清单内的表不存在（schema 与脚本不一致）：%', missing;
  END IF;

  SELECT string_agg(format('%I.%I.%I -> %I', sn.nspname, s.relname, c.conname, t.relname), '; '
                    ORDER BY sn.nspname, s.relname, c.conname)
    INTO stray_fk
    FROM pg_constraint c
    JOIN pg_class s ON s.oid = c.conrelid
    JOIN pg_namespace sn ON sn.oid = s.relnamespace
    JOIN pg_class t ON t.oid = c.confrelid
    JOIN pg_namespace tn ON tn.oid = t.relnamespace
   WHERE c.contype = 'f'
     AND tn.nspname = 'public'
     AND t.relname::text = ANY (cleared)
     AND NOT (sn.nspname = 'public' AND s.relname::text = ANY (cleared));
  IF stray_fk IS NOT NULL THEN
    RAISE EXCEPTION 'reset-base-operations: 发现未登记的基地关联外键，拒绝执行：%', stray_fk;
  END IF;

  SELECT string_agg(c.relname::text, ', ' ORDER BY c.relname) INTO stray_table
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
   WHERE n.nspname = 'public'
     AND c.relkind IN ('r', 'p')
     AND c.relname LIKE 'base\_%'
     AND NOT (c.relname::text = ANY (cleared));
  IF stray_table IS NOT NULL THEN
    RAISE EXCEPTION 'reset-base-operations: 发现未登记的 base_* 表，拒绝执行：%', stray_table;
  END IF;
END
$guard$;

-- 锁住全部基地实例表（阻塞并发写，允许读），防止误在服务运行时执行造成半途插入。
LOCK TABLE
  bases, base_sites, base_control_leases, base_inventory, base_devices,
  robot_operators, base_power_state, base_projects, base_project_steps,
  base_manufacturing_jobs, base_manufacturing_outputs, decision_records,
  cooperation_requests, base_weather_schedule, base_orders, base_purchases
IN EXCLUSIVE MODE;

-- ---------------------------------------------------------------------------
-- 1. 基地实例表：按外键从子到父删除（全部外键均为 ON DELETE RESTRICT）。
-- ---------------------------------------------------------------------------
DELETE FROM base_manufacturing_outputs;
DELETE FROM cooperation_requests;
DELETE FROM decision_records;
DELETE FROM base_project_steps;
DELETE FROM base_projects;
DELETE FROM base_manufacturing_jobs;
DELETE FROM robot_operators;
DELETE FROM base_devices;
DELETE FROM base_inventory;
DELETE FROM base_power_state;
DELETE FROM base_weather_schedule;
DELETE FROM base_orders;
DELETE FROM base_purchases;
DELETE FROM base_control_leases;
DELETE FROM base_sites;
DELETE FROM bases;

-- ---------------------------------------------------------------------------
-- 2. 基地命令收据（精确限定 command_kind + actor_scope；旧世界收据不动）。
-- ---------------------------------------------------------------------------
DELETE FROM command_receipts
 WHERE command_kind LIKE 'base.%'
   AND (
         actor_scope LIKE 'base:%'
      OR (actor_scope LIKE 'account:%' AND command_kind = 'base.provision')
   );

-- ---------------------------------------------------------------------------
-- 3. 吊销全部会话（迫使重新登录 → 客户端调用 POST /base/provision）。
-- ---------------------------------------------------------------------------
UPDATE sessions SET revoked_at = now() WHERE revoked_at IS NULL;

-- ---------------------------------------------------------------------------
-- 4. 提交前自检：任何一项不满足即抛错，整个事务回滚。
-- ---------------------------------------------------------------------------
DO $verify$
DECLARE
  cleared constant text[] := ARRAY[
    'bases', 'base_sites', 'base_control_leases', 'base_inventory', 'base_devices',
    'robot_operators', 'base_power_state', 'base_projects', 'base_project_steps',
    'base_manufacturing_jobs', 'base_manufacturing_outputs', 'decision_records',
    'cooperation_requests', 'base_weather_schedule', 'base_orders', 'base_purchases'
  ];
  t text;
  remaining bigint;
BEGIN
  FOREACH t IN ARRAY cleared LOOP
    EXECUTE format('SELECT count(*) FROM public.%I', t) INTO remaining;
    IF remaining <> 0 THEN
      RAISE EXCEPTION 'reset-base-operations: % 仍有 % 行', t, remaining;
    END IF;
  END LOOP;

  SELECT count(*) INTO remaining
    FROM command_receipts
   WHERE command_kind LIKE 'base.%'
     AND (
           actor_scope LIKE 'base:%'
        OR (actor_scope LIKE 'account:%' AND command_kind = 'base.provision')
     );
  IF remaining <> 0 THEN
    RAISE EXCEPTION 'reset-base-operations: 仍有 % 条基地命令收据', remaining;
  END IF;

  SELECT count(*) INTO remaining FROM sessions WHERE revoked_at IS NULL;
  IF remaining <> 0 THEN
    RAISE EXCEPTION 'reset-base-operations: 仍有 % 个未吊销会话', remaining;
  END IF;
END
$verify$;

COMMIT;
