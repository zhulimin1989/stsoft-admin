-- 清理已回滚的落地埋点功能残留:landing_visits 表(空、无引用)直接删除。
DROP TABLE IF EXISTS "landing_visits";

-- 建表迁移(20260707000000_landing_visits)已随功能回滚从代码库移除,
-- 但其在 _prisma_migrations 里的应用记录仍在。删掉这条孤儿记录,保持迁移历史干净。
DELETE FROM "_prisma_migrations" WHERE "migration_name" = '20260707000000_landing_visits';
