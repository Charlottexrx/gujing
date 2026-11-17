import { sqliteTable, text, integer } from 'drizzle-orm/sqlite-core';
export const monitorTasks = sqliteTable('monitor_tasks', {
 id: text('id').primaryKey(), owner: text('owner').notNull(), data: text('data').notNull(),
 revision: integer('revision').notNull().default(0), leaseUntil: text('lease_until'),
});
export const monitorRuns = sqliteTable('monitor_runs', {
 id: text('id').primaryKey(), taskId: text('task_id').notNull(), owner: text('owner').notNull(),
 checkedAt: text('checked_at').notNull(), data: text('data').notNull(),
});

export const apiUsage = sqliteTable('api_usage', { id: text('id').primaryKey(), count: integer('count').notNull().default(0) });
