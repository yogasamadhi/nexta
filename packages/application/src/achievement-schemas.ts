import { z } from 'zod';

import { achievementSnapshotSchema } from './schemas';

const nonEmptyString = z.string().trim().min(1);
const safeVersion = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);

export const createAchievementInputSchema = z
  .object({
    completionRecordId: nonEmptyString,
    title: nonEmptyString.optional(),
    summary: z.string().nullable().optional(),
  })
  .strict();

export const updateAchievementInputSchema = z
  .object({
    achievementId: nonEmptyString,
    patch: z
      .object({
        title: nonEmptyString.optional(),
        summary: z.string().nullable().optional(),
      })
      .strict()
      .refine((patch) => Object.keys(patch).length > 0, {
        message: 'Achievement patch must not be empty.',
      }),
  })
  .strict();

export const setAchievementHiddenInputSchema = z
  .object({ achievementId: nonEmptyString, hidden: z.boolean() })
  .strict();

export const achievementRangeInputSchema = z
  .object({ start: nonEmptyString, end: nonEmptyString })
  .strict();

export const achievementListInputSchema = z
  .object({
    range: achievementRangeInputSchema.optional(),
    cursor: nonEmptyString.optional(),
    limit: z.number().int().positive().max(50).default(20),
  })
  .strict();

export const achievementPageSchema = z
  .object({
    items: z.array(achievementSnapshotSchema).max(50),
    nextCursor: nonEmptyString.nullable(),
  })
  .strict();

export const achievementMutationResultSchema = z
  .object({
    achievement: achievementSnapshotSchema,
    operationId: nonEmptyString,
    stateVersion: safeVersion,
    planRevision: safeVersion,
  })
  .strict();

export type CreateAchievementInput = z.input<
  typeof createAchievementInputSchema
>;
export type UpdateAchievementInput = z.input<
  typeof updateAchievementInputSchema
>;
export type SetAchievementHiddenInput = z.input<
  typeof setAchievementHiddenInputSchema
>;
export type AchievementRangeInput = z.input<typeof achievementRangeInputSchema>;
export type AchievementListInput = z.input<typeof achievementListInputSchema>;
export type AchievementPage = z.output<typeof achievementPageSchema>;
export type AchievementMutationResult = z.output<
  typeof achievementMutationResultSchema
>;
