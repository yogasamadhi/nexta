import { z } from 'zod';

export * from './errors';
export * from './agent-run-service';
export * from './achievement-schemas';
export * from './achievement-service';
export * from './execution-schemas';
export * from './execution-service';
export * from './energy-check-in-service';
export * from './goal-project-services';
export * from './idempotency';
export * from './calendar-service';
export * from './integration-ports';
export * from './integration-schemas';
export * from './integration-service';
export * from './ports';
export * from './planning-query-service';
export * from './preference-schemas';
export * from './preference-service';
export * from './provider-timeout';
export * from './reflection-service';
export * from './relax-service';
export * from './preview-store';
export * from './schedule-ports';
export * from './schedule-schemas';
export * from './schedule-service';
export * from './schedule-types';
export * from './schemas';
export * from './task-service';
export * from './time-block-adjustment-service';
export * from './user-model-service';
export * from './wellbeing-schemas';

const runtimeEnvironmentSchema = z.enum([
  'development',
  'preview',
  'production',
]);

export const runtimeConfigSchema = z
  .object({
    environment: runtimeEnvironmentSchema,
  })
  .strict();

export type RuntimeConfig = z.infer<typeof runtimeConfigSchema>;

export function parseRuntimeConfig(input: unknown): RuntimeConfig {
  return runtimeConfigSchema.parse(input);
}

export * from './cloud-sync';

export { syncEntityFields } from './sync-entity-fields';
