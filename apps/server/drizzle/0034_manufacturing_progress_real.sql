-- 评审 B002（2026-09-22）：制造结算按 tick 累加小数工作量（≈0.08/tick），
-- 整数列令 saveJobProgress 类型崩溃 → 基地结算事务每 tick 回滚 → 模拟静默冻结。
-- 改为双精度以承载小数累加；已有整数值无损转换。
ALTER TABLE "base_manufacturing_jobs" ALTER COLUMN "current_unit_work_done" SET DATA TYPE double precision;
