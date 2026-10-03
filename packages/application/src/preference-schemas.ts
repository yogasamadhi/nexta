import {
  assertValidUserPreference,
  normalizePreferenceJson,
  parseInstant,
  parseOperationId,
  parseUserPreferenceId,
  type UserPreference,
} from '@workspace/domain';
import { z } from 'zod';

const nonEmptyString = z.string().trim().min(1);
const localTime = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);
const disambiguation = z.enum(['earlier', 'later']).optional();
const isoWeekday = z.union([
  z.literal(1),
  z.literal(2),
  z.literal(3),
  z.literal(4),
  z.literal(5),
  z.literal(6),
  z.literal(7),
]);
const preferenceKeySchema = z.enum([
  'scheduling.timeZone.v1',
  'scheduling.workingHours.v1',
  'calendar.busySources.v1',
  'notification.leadMinutes.v1',
  'focus.mindfulTransition.enabled.v1',
  'personalization.enabled.v1',
  'wellbeing.checkIn.enabled.v1',
  'wellbeing.relaxSuggestions.enabled.v1',
]);

export const schedulingTimeZonePreferenceKey =
  'scheduling.timeZone.v1' as const;
export const schedulingWorkingHoursPreferenceKey =
  'scheduling.workingHours.v1' as const;
export const calendarBusySourcesPreferenceKey =
  'calendar.busySources.v1' as const;
export const notificationLeadMinutesPreferenceKey =
  'notification.leadMinutes.v1' as const;
export const focusMindfulTransitionEnabledPreferenceKey =
  'focus.mindfulTransition.enabled.v1' as const;
export const personalizationEnabledPreferenceKey =
  'personalization.enabled.v1' as const;
export const checkInEnabledPreferenceKey =
  'wellbeing.checkIn.enabled.v1' as const;
export const relaxSuggestionsEnabledPreferenceKey =
  'wellbeing.relaxSuggestions.enabled.v1' as const;

export type SupportedPreferenceKey = z.infer<typeof preferenceKeySchema>;

export const workingHoursRuleSchema = z
  .object({
    id: nonEmptyString,
    weekdays: z
      .array(isoWeekday)
      .min(1)
      .max(7)
      .refine((weekdays) => new Set(weekdays).size === weekdays.length, {
        message: 'Working-hours weekdays must be unique.',
      }),
    startLocalTime: localTime,
    endLocalTime: localTime,
    energyLevel: nonEmptyString.nullable().optional(),
    startDisambiguation: disambiguation,
    endDisambiguation: disambiguation,
  })
  .strict()
  .refine((rule) => rule.startLocalTime !== rule.endLocalTime, {
    message: 'Working-hours endpoints must differ.',
  });

export const schedulingTimeZonePreferenceValueSchema = z
  .object({ timeZone: nonEmptyString })
  .strict();

export const schedulingWorkingHoursPreferenceValueSchema = z
  .object({
    timeZone: nonEmptyString,
    rules: z.array(workingHoursRuleSchema).min(1).max(64),
  })
  .strict()
  .refine(
    (value) =>
      new Set(value.rules.map((rule) => rule.id)).size === value.rules.length,
    {
      message: 'Working-hours rule ids must be unique.',
    },
  );

export const calendarBusySourcesPreferenceValueSchema = z
  .object({
    sources: z
      .array(
        z
          .object({
            provider: nonEmptyString,
            calendarId: nonEmptyString,
            enabled: z.boolean(),
          })
          .strict(),
      )
      .max(64)
      .refine(
        (sources) =>
          new Set(
            sources.map(({ provider, calendarId }) =>
              JSON.stringify([provider, calendarId]),
            ),
          ).size === sources.length,
        { message: 'Busy calendar sources must be unique.' },
      ),
  })
  .strict();

export const notificationLeadMinutesPreferenceValueSchema = z
  .object({
    leadMinutes: z
      .number()
      .int()
      .min(0)
      .max(24 * 60),
  })
  .strict();

export const focusMindfulTransitionEnabledPreferenceValueSchema = z
  .object({ enabled: z.boolean() })
  .strict();

export const personalizationEnabledPreferenceValueSchema = z
  .object({ enabled: z.boolean() })
  .strict();

export const checkInEnabledPreferenceValueSchema = z
  .object({ enabled: z.boolean() })
  .strict();

export const relaxSuggestionsEnabledPreferenceValueSchema = z
  .object({ enabled: z.boolean() })
  .strict();

export const updatePreferenceInputSchema = z.discriminatedUnion('key', [
  z
    .object({
      key: z.literal(schedulingTimeZonePreferenceKey),
      value: schedulingTimeZonePreferenceValueSchema,
    })
    .strict(),
  z
    .object({
      key: z.literal(schedulingWorkingHoursPreferenceKey),
      value: schedulingWorkingHoursPreferenceValueSchema,
    })
    .strict(),
  z
    .object({
      key: z.literal(calendarBusySourcesPreferenceKey),
      value: calendarBusySourcesPreferenceValueSchema,
    })
    .strict(),
  z
    .object({
      key: z.literal(notificationLeadMinutesPreferenceKey),
      value: notificationLeadMinutesPreferenceValueSchema,
    })
    .strict(),
  z
    .object({
      key: z.literal(focusMindfulTransitionEnabledPreferenceKey),
      value: focusMindfulTransitionEnabledPreferenceValueSchema,
    })
    .strict(),
  z
    .object({
      key: z.literal(personalizationEnabledPreferenceKey),
      value: personalizationEnabledPreferenceValueSchema,
    })
    .strict(),
  z
    .object({
      key: z.literal(checkInEnabledPreferenceKey),
      value: checkInEnabledPreferenceValueSchema,
    })
    .strict(),
  z
    .object({
      key: z.literal(relaxSuggestionsEnabledPreferenceKey),
      value: relaxSuggestionsEnabledPreferenceValueSchema,
    })
    .strict(),
]);

export type UpdatePreferenceInput = z.input<typeof updatePreferenceInputSchema>;

export const readPreferenceKeySchema = preferenceKeySchema;

export const userPreferenceSnapshotSchema = z
  .object({
    id: nonEmptyString,
    key: nonEmptyString,
    valueJson: z.unknown(),
    updatedAt: nonEmptyString,
  })
  .strict()
  .transform((value): UserPreference => {
    const preference: UserPreference = {
      id: parseUserPreferenceId(value.id),
      key: value.key,
      valueJson: normalizePreferenceJson(value.valueJson),
      updatedAt: parseInstant(value.updatedAt),
    };
    assertValidUserPreference(preference);
    return preference;
  });

const storedVersion = z
  .number()
  .int()
  .nonnegative()
  .max(Number.MAX_SAFE_INTEGER);

export const preferenceMutationResultSchema = z
  .object({
    operationId: nonEmptyString.transform((value) => parseOperationId(value)),
    stateVersion: storedVersion,
    planRevision: storedVersion,
    preference: userPreferenceSnapshotSchema,
  })
  .strict();

export type PreferenceMutationResult = z.output<
  typeof preferenceMutationResultSchema
>;
