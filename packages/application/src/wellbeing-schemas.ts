import {
  assertValidDailyReflection,
  assertValidEnergyCheckIn,
  assertValidRelaxSession,
  parseCompletionRecordId,
  parseDailyReflectionId,
  parseEnergyCheckInId,
  parseInstant,
  parseLocalDate,
  parseOperationId,
  parseRelaxSessionId,
  parseTaskId,
  parseTimeZoneId,
  type DailyReflection,
  type EnergyCheckIn,
  type RelaxSession,
} from '@workspace/domain';
import { z } from 'zod';

const nonEmptyString = z.string().trim().min(1);
const safeVersion = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const optionalNote = z.string().max(4_000).nullable().optional();

export const reflectionDayInputSchema = z
  .object({
    localDate: nonEmptyString,
    timeZone: nonEmptyString,
    range: z.object({ start: nonEmptyString, end: nonEmptyString }).strict(),
  })
  .strict();

export const refreshDailyReflectionInputSchema = reflectionDayInputSchema
  .extend({ userNote: optionalNote })
  .strict();

export const recordEnergyCheckInInputSchema = z
  .object({
    level: z.union([
      z.literal(1),
      z.literal(2),
      z.literal(3),
      z.literal(4),
      z.literal(5),
    ]),
    note: optionalNote,
  })
  .strict();

export const energyCheckInDayInputSchema = z
  .object({ localDate: nonEmptyString, timeZone: nonEmptyString })
  .strict();

export const startRelaxSessionInputSchema = z
  .object({
    type: z.enum(['breathing', 'pause', 'stretch', 'ambient']),
    plannedMinutes: z.number().int().positive().max(60),
    source: z.enum(['relax_tab', 'today', 'focus']),
  })
  .strict();

export const endRelaxSessionInputSchema = z
  .object({
    sessionId: nonEmptyString,
    outcome: z.enum(['completed', 'abandoned']),
  })
  .strict();

export const relaxSessionRangeInputSchema = z
  .object({ start: nonEmptyString, end: nonEmptyString })
  .strict();

export const reflectionWinSnapshotSchema = z
  .object({
    completionRecordId: nonEmptyString,
    taskId: nonEmptyString,
    title: nonEmptyString,
    completedAt: nonEmptyString,
  })
  .strict()
  .transform((value) => ({
    completionRecordId: parseCompletionRecordId(value.completionRecordId),
    taskId: parseTaskId(value.taskId),
    title: value.title,
    completedAt: parseInstant(value.completedAt),
  }));

export const dailyReflectionSnapshotSchema = z
  .object({
    id: nonEmptyString,
    localDate: nonEmptyString,
    timeZone: nonEmptyString,
    summary: nonEmptyString,
    wins: z.array(reflectionWinSnapshotSchema).max(3),
    adjustmentSuggestion: z.string().nullable(),
    userNote: z.string().nullable(),
    generatedBy: z.enum(['local_facts', 'model_validated']),
    createdAt: nonEmptyString,
    updatedAt: nonEmptyString,
  })
  .strict()
  .transform((value): DailyReflection => {
    const reflection: DailyReflection = {
      ...value,
      id: parseDailyReflectionId(value.id),
      localDate: parseLocalDate(value.localDate),
      timeZone: parseTimeZoneId(value.timeZone),
      createdAt: parseInstant(value.createdAt),
      updatedAt: parseInstant(value.updatedAt),
    };
    assertValidDailyReflection(reflection);
    return reflection;
  });

export const energyCheckInSnapshotSchema = z
  .object({
    id: nonEmptyString,
    localDate: nonEmptyString,
    timeZone: nonEmptyString,
    level: z.union([
      z.literal(1),
      z.literal(2),
      z.literal(3),
      z.literal(4),
      z.literal(5),
    ]),
    note: z.string().nullable(),
    createdAt: nonEmptyString,
  })
  .strict()
  .transform((value): EnergyCheckIn => {
    const checkIn: EnergyCheckIn = {
      ...value,
      id: parseEnergyCheckInId(value.id),
      localDate: parseLocalDate(value.localDate),
      timeZone: parseTimeZoneId(value.timeZone),
      createdAt: parseInstant(value.createdAt),
    };
    assertValidEnergyCheckIn(checkIn);
    return checkIn;
  });

export const relaxSessionSnapshotSchema = z
  .object({
    id: nonEmptyString,
    type: z.enum(['breathing', 'pause', 'stretch', 'ambient']),
    plannedMinutes: z.number().int().positive(),
    actualSeconds: z.number().int().nonnegative().nullable(),
    startedAt: nonEmptyString,
    endedAt: nonEmptyString.nullable(),
    source: z.enum(['relax_tab', 'today', 'focus']),
    status: z.enum(['active', 'completed', 'abandoned']),
    timingQuality: z.enum(['trusted', 'needs_review']),
    createdAt: nonEmptyString,
  })
  .strict()
  .transform((value): RelaxSession => {
    const session: RelaxSession = {
      ...value,
      id: parseRelaxSessionId(value.id),
      startedAt: parseInstant(value.startedAt),
      endedAt: value.endedAt === null ? null : parseInstant(value.endedAt),
      createdAt: parseInstant(value.createdAt),
    };
    assertValidRelaxSession(session);
    return session;
  });

export const reflectionMutationResultSchema = z
  .object({
    reflection: dailyReflectionSnapshotSchema,
    operationId: nonEmptyString.transform(parseOperationId),
    stateVersion: safeVersion,
    planRevision: safeVersion,
    sourceCompletionRecordCount: safeVersion,
  })
  .strict();

export const energyCheckInMutationResultSchema = z
  .object({
    checkIn: energyCheckInSnapshotSchema,
    operationId: nonEmptyString.transform(parseOperationId),
    stateVersion: safeVersion,
    planRevision: safeVersion,
  })
  .strict();

export const relaxSessionMutationResultSchema = z
  .object({
    session: relaxSessionSnapshotSchema,
    operationId: nonEmptyString.transform(parseOperationId),
    stateVersion: safeVersion,
    planRevision: safeVersion,
  })
  .strict();

export type ReflectionDayInput = z.input<typeof reflectionDayInputSchema>;
export type RefreshDailyReflectionInput = z.input<
  typeof refreshDailyReflectionInputSchema
>;
export type RecordEnergyCheckInInput = z.input<
  typeof recordEnergyCheckInInputSchema
>;
export type EnergyCheckInDayInput = z.input<typeof energyCheckInDayInputSchema>;
export type StartRelaxSessionInput = z.input<
  typeof startRelaxSessionInputSchema
>;
export type EndRelaxSessionInput = z.input<typeof endRelaxSessionInputSchema>;
export type RelaxSessionRangeInput = z.input<
  typeof relaxSessionRangeInputSchema
>;
export type ReflectionMutationResult = z.output<
  typeof reflectionMutationResultSchema
>;
export type EnergyCheckInMutationResult = z.output<
  typeof energyCheckInMutationResultSchema
>;
export type RelaxSessionMutationResult = z.output<
  typeof relaxSessionMutationResultSchema
>;
