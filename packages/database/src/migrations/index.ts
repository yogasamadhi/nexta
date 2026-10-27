import { cloudBootstrapSql } from './0010-cloud-bootstrap';
import { cloudSyncSql } from './0009-cloud-sync';
import { phase1FoundationSql } from './0000-phase1-foundation';
import { phase2ScheduleCommitSql } from './0001-phase2-schedule-commit';
import { phase3CalendarNotificationsSql } from './0002-phase3-calendar-notifications';
import { phase3ExternalMutationIntentsSql } from './0003-phase3-external-mutation-intents';
import { phase4UserPreferencesSql } from './0004-phase4-user-preferences';
import { phase5ExecutionAchievementsSql } from './0005-phase5-execution-achievements';
import { phase6AgentRunsSql } from './0006-phase6-agent-runs';
import { phase7UserModelFeaturesSql } from './0007-phase7-user-model-features';
import { phase8WellbeingSql } from './0008-phase8-wellbeing';

export interface SqliteMigration {
  /** Stable, ordered identifier. Once shipped it must never be reused. */
  readonly id: string;
  /** Build-time digest of the normalized SQL, used to detect edited history. */
  readonly checksum: `sha256:${string}`;
  /** SQL statements separated by the Drizzle statement breakpoint marker. */
  readonly sql: string;
}

export const phase1FoundationMigration = {
  id: '0000_phase1_foundation',
  checksum:
    'sha256:6c202fff658b485ac387b186934cc7521d17abcb4762215e521ea9260d1f7636',
  sql: phase1FoundationSql,
} as const satisfies SqliteMigration;

export const phase2ScheduleCommitMigration = {
  id: '0001_phase2_schedule_commit',
  checksum:
    'sha256:4dba830baec5c753deab9f397ae1b88c3849d666d73364b431e294558eb4a1ff',
  sql: phase2ScheduleCommitSql,
} as const satisfies SqliteMigration;

export const phase3CalendarNotificationsMigration = {
  id: '0002_phase3_calendar_notifications',
  checksum:
    'sha256:600f56f4c5fa7be19ac5f8bca3dfe71bb1e15a13b097acc1204ad4ff79dcfe36',
  sql: phase3CalendarNotificationsSql,
} as const satisfies SqliteMigration;

export const phase3ExternalMutationIntentsMigration = {
  id: '0003_phase3_external_mutation_intents',
  checksum:
    'sha256:5615f33faeeb661aae3a369e1f6908e2101ba276475906936e9dbfd98332f2f1',
  sql: phase3ExternalMutationIntentsSql,
} as const satisfies SqliteMigration;

export const phase4UserPreferencesMigration = {
  id: '0004_phase4_user_preferences',
  checksum:
    'sha256:0ebc2ba5dd5339993f33cf38cc9015368d786995c61c3f22d2cce50b497b9369',
  sql: phase4UserPreferencesSql,
} as const satisfies SqliteMigration;

export const phase5ExecutionAchievementsMigration = {
  id: '0005_phase5_execution_achievements',
  checksum:
    'sha256:d2d588f66a54861571d4efac24d1cb9276288b02f32acb37791bfcc4ebf3234a',
  sql: phase5ExecutionAchievementsSql,
} as const satisfies SqliteMigration;

export const phase6AgentRunsMigration = {
  id: '0006_phase6_agent_runs',
  checksum:
    'sha256:9497deb16558a32d822d0fb44236dce1f29bc3f342f18fb67cdbea2798ea740f',
  sql: phase6AgentRunsSql,
} as const satisfies SqliteMigration;

export const phase7UserModelFeaturesMigration = {
  id: '0007_phase7_user_model_features',
  checksum:
    'sha256:5d83bc687dd5708d9c97a0a51debc9265582b41291ae08dc72f032b3ba3cadfa',
  sql: phase7UserModelFeaturesSql,
} as const satisfies SqliteMigration;

export const phase8WellbeingMigration = {
  id: '0008_phase8_wellbeing',
  checksum:
    'sha256:2e2b99a68f1a6324653a33913e42e2d1f530050c6646fc4e7613d59e3523d2c5',
  sql: phase8WellbeingSql,
} as const satisfies SqliteMigration;

export const cloudSyncMigration = {
  id: '0009_cloud_sync',
  checksum:
    'sha256:09a287468a3e6ec8ac5bc9ac9c1206c5f13b7d89a8dbd9cce9d4c5f9db4febd2',
  sql: cloudSyncSql,
} as const satisfies SqliteMigration;

export const cloudBootstrapMigration = {
  id: '0010_cloud_bootstrap',
  checksum:
    'sha256:47d5c6ba2d82946e114b7c28ccf570414d10e295a85e4e348f786044e25e5e4f',
  sql: cloudBootstrapSql,
} as const satisfies SqliteMigration;

/** Ordered migration manifest bundled with the app. */
export const databaseMigrations = [
  phase1FoundationMigration,
  phase2ScheduleCommitMigration,
  phase3CalendarNotificationsMigration,
  phase3ExternalMutationIntentsMigration,
  phase4UserPreferencesMigration,
  phase5ExecutionAchievementsMigration,
  phase6AgentRunsMigration,
  phase7UserModelFeaturesMigration,
  phase8WellbeingMigration,
  cloudSyncMigration,
  cloudBootstrapMigration,
] as const;

export {
  cloudBootstrapSql,
  cloudSyncSql,
  phase1FoundationSql,
  phase2ScheduleCommitSql,
  phase3CalendarNotificationsSql,
  phase3ExternalMutationIntentsSql,
  phase4UserPreferencesSql,
  phase5ExecutionAchievementsSql,
  phase6AgentRunsSql,
  phase7UserModelFeaturesSql,
  phase8WellbeingSql,
};
