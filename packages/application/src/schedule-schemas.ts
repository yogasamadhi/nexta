import { z } from 'zod';

const nonEmptyString = z.string().trim().min(1);
const safeVersion = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);

const requestedTimeRangeSchema = z
  .object({ start: nonEmptyString, end: nonEmptyString })
  .strict();

export const schedulePreviewRequestSchema = z
  .object({
    reason: nonEmptyString,
    taskIds: z.array(nonEmptyString).min(1).optional(),
    timeRange: requestedTimeRangeSchema.optional(),
  })
  .strict()
  .superRefine((request, context) => {
    if (
      request.taskIds !== undefined &&
      new Set(request.taskIds).size !== request.taskIds.length
    ) {
      context.addIssue({
        code: 'custom',
        message: 'taskIds must not contain duplicates.',
        path: ['taskIds'],
      });
    }
  });

export const scheduleCommitInputSchema = z
  .object({
    previewId: nonEmptyString,
    expectedStateVersion: safeVersion,
  })
  .strict();

export const integrationStatusSchema = z.enum([
  'synced',
  'pending',
  'permission_required',
  'failed',
  'disabled',
  'reconciliation_required',
  'superseded',
]);

export const scheduleCommitResultSchema = z
  .object({
    operationId: nonEmptyString,
    local: z.literal('committed'),
    planRevision: safeVersion,
    stateVersion: safeVersion,
    calendar: integrationStatusSchema,
    notifications: integrationStatusSchema,
  })
  .strict();

const planBlockCandidateSchema = z
  .object({
    stableKey: nonEmptyString,
    timeBlockId: nonEmptyString.nullable(),
    taskId: nonEmptyString.nullable(),
    taskTitle: nonEmptyString.nullable(),
    type: z.enum(['task', 'break', 'relax', 'buffer']),
    startAt: nonEmptyString,
    endAt: nonEmptyString,
    status: z.enum(['planned', 'started', 'completed', 'skipped', 'canceled']),
    locked: z.boolean(),
    changeReason: z.enum([
      'protected_existing',
      'preserved_existing',
      'moved_existing',
      'resized_existing',
      'moved_and_resized_existing',
      'new_allocation',
      'removed_by_plan',
    ]),
  })
  .strict();

const planChangeSchema = z.discriminatedUnion('kind', [
  z
    .object({
      kind: z.literal('create'),
      stableKey: nonEmptyString,
      before: z.null(),
      after: planBlockCandidateSchema,
    })
    .strict(),
  z
    .object({
      kind: z.enum(['update', 'cancel']),
      stableKey: nonEmptyString,
      timeBlockId: nonEmptyString,
      before: planBlockCandidateSchema,
      after: planBlockCandidateSchema,
    })
    .strict(),
]);

export const schedulePreviewSchema = z
  .object({
    previewId: nonEmptyString,
    basedOnStateVersion: safeVersion,
    basedOnPlanRevision: safeVersion,
    inputHash: nonEmptyString,
    schedulerVersion: nonEmptyString,
    policyVersion: nonEmptyString,
    createdAt: nonEmptyString,
    expiresAt: nonEmptyString,
    timeZone: nonEmptyString,
    busyFreshness: z
      .object({
        capturedAt: nonEmptyString.nullable(),
        completeness: z.enum([
          'complete',
          'partial',
          'missing',
          'not_configured',
        ]),
        scopes: z.array(
          z
            .object({
              provider: nonEmptyString,
              calendarId: nonEmptyString,
              capturedAt: nonEmptyString.nullable(),
              completeness: z.enum(['complete', 'partial', 'missing']),
            })
            .strict(),
        ),
      })
      .strict(),
    changedBlocks: z.array(planChangeSchema),
    unscheduled: z.array(
      z
        .object({
          taskId: nonEmptyString,
          taskTitle: nonEmptyString,
          remainingMinutes: z.number().finite().positive().optional(),
          reasonCode: z.enum([
            'missing_duration',
            'remaining_estimate_required',
            'insufficient_time',
            'deadline_infeasible',
            'unsupported_dependency',
          ]),
          message: nonEmptyString,
        })
        .strict(),
    ),
    warnings: z.array(
      z
        .object({
          entityType: z.enum(['schedule', 'task', 'block']),
          entityId: nonEmptyString.nullable(),
          entityTitle: nonEmptyString.nullable(),
          code: z.enum([
            'protected_busy_conflict',
            'protected_block_conflict',
            'protected_outside_working_window',
            'protected_task_constraint_conflict',
            'protected_commitment_exceeds_remaining',
            'orphan_existing_block_preserved',
            'existing_block_omitted',
            'partial_schedule',
            'deadline_risk',
          ]),
          severity: z.enum(['info', 'warning', 'error']),
          message: nonEmptyString,
        })
        .strict(),
    ),
    summary: nonEmptyString,
    riskAssessment: z
      .object({
        autoCommitEligible: z.literal(false),
        requiresExplicitConfirmation: z.literal(true),
        changedBlockCount: safeVersion,
        hasBlockingWarnings: z.boolean(),
      })
      .strict(),
  })
  .strict();
