-- 评审 D008 内容增补：新增建设位 B（第二工程位）。
-- 存量基地回填 site_b（新基地由 provision seed 直接创建）；缺失才插入，幂等。
INSERT INTO "base_sites" ("base_id", "site_key", "state")
SELECT b."id", 'site_b', 'free'
FROM "bases" b
WHERE NOT EXISTS (
  SELECT 1 FROM "base_sites" s WHERE s."base_id" = b."id" AND s."site_key" = 'site_b'
);
