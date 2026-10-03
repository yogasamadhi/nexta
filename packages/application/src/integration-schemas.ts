import { parseInstant } from '@workspace/domain';
import { z } from 'zod';

const nonEmptyString = z.string().trim().min(1);
const nullableNonEmptyString = nonEmptyString.nullable();
const safeVersion = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);

export const instantSchema = z.string().superRefine((value, context) => {
  try {
    parseInstant(value);
  } catch {
    context.addIssue({
      code: 'custom',
      message: 'Expected a canonical UTC Instant.',
    });
  }
});

export const integrationTimeRangeSchema = z
  .object({ start: instantSchema, end: instantSchema })
  .strict()
  .superRefine((range, context) => {
    if (Date.parse(range.end) <= Date.parse(range.start)) {
      context.addIssue({
        code: 'custom',
        message: 'Range end must be after start.',
        path: ['end'],
      });
    }
  });

export const permissionStateSchema = z.enum([
  'not_determined',
  'granted',
  'denied',
  'unavailable',
]);

export const permissionCapabilitySchema = z
  .object({
    status: permissionStateSchema,
    canAskAgain: z.boolean(),
    settingsRequired: z.boolean(),
  })
  .strict()
  .superRefine((permission, context) => {
    const expectedSettingsRequired =
      permission.status === 'denied' && !permission.canAskAgain;
    if (permission.settingsRequired !== expectedSettingsRequired) {
      context.addIssue({
        code: 'custom',
        message:
          'settingsRequired must identify a denied permission that cannot be requested again.',
        path: ['settingsRequired'],
      });
    }
  });

export const calendarPermissionStateSchema = z
  .object({
    read: permissionCapabilitySchema,
    write: permissionCapabilitySchema,
  })
  .strict();

export const notificationPermissionStateSchema = permissionCapabilitySchema;

export const calendarInfoSchema = z
  .object({
    provider: nonEmptyString,
    calendarId: nonEmptyString,
    title: nonEmptyString,
    allowsRead: z.boolean(),
    allowsWrite: z.boolean(),
  })
  .strict();

export const calendarInfoListSchema = z.array(calendarInfoSchema);

export const calendarBusyRequestSchema = z
  .object({
    provider: nonEmptyString,
    calendarId: nonEmptyString,
    range: integrationTimeRangeSchema,
  })
  .strict();

export const calendarCachedBusyRequestSchema = calendarBusyRequestSchema
  .extend({ limit: z.number().int().positive().max(200).default(100) })
  .strict();

export const calendarCachedBusyResultSchema = z
  .object({
    provider: nonEmptyString,
    calendarId: nonEmptyString,
    range: integrationTimeRangeSchema,
    capturedAt: instantSchema.nullable(),
    completeness: z.enum(['complete', 'partial', 'missing']),
    events: z
      .array(
        z
          .object({
            startAt: instantSchema,
            endAt: instantSchema,
            busy: z.literal(true),
          })
          .strict(),
      )
      .max(200),
    truncated: z.boolean(),
  })
  .strict();

export const calendarBusyEventSchema = z
  .object({
    externalEventId: nonEmptyString,
    occurrenceKey: nullableNonEmptyString,
    startAt: instantSchema,
    endAt: instantSchema,
    busy: z.boolean(),
    contentHash: nonEmptyString,
  })
  .strict()
  .superRefine((event, context) => {
    if (Date.parse(event.endAt) <= Date.parse(event.startAt)) {
      context.addIssue({
        code: 'custom',
        message: 'Event end must be after start.',
        path: ['endAt'],
      });
    }
  });

export const busySnapshotResultSchema = z
  .object({
    provider: nonEmptyString,
    calendarId: nonEmptyString,
    range: integrationTimeRangeSchema,
    fetchedAt: instantSchema,
    completeness: z.enum(['complete', 'partial']),
    events: z.array(calendarBusyEventSchema),
  })
  .strict();

export const calendarRefSchema = z
  .object({
    provider: nonEmptyString,
    calendarId: nonEmptyString,
    ownershipKey: nonEmptyString,
    ownershipVerified: z.literal(true),
  })
  .strict();

export const calendarProvisioningSchema = z
  .object({
    provider: nonEmptyString,
    ownershipKey: nonEmptyString,
    title: nonEmptyString,
    color: nullableNonEmptyString,
    androidSource: nullableNonEmptyString,
  })
  .strict();

export const calendarProvisioningAbsenceConfirmationSchema = z
  .object({
    jobId: nonEmptyString,
    confirmedAbsentInSystemCalendar: z.literal(true),
  })
  .strict();

export const calendarProvisioningRecoveryResultSchema = z
  .object({
    operationId: nonEmptyString,
    jobId: nonEmptyString,
    stateVersion: safeVersion,
    planRevision: safeVersion,
    releasedIntentId: nonEmptyString,
    requeuedJobCount: safeVersion,
  })
  .strict();

export const externalEventRefSchema = z
  .object({
    provider: nonEmptyString,
    calendarId: nonEmptyString,
    externalEventId: nonEmptyString,
    occurrenceKey: nullableNonEmptyString,
  })
  .strict();

export const externalEventMutationResultSchema = z.discriminatedUnion(
  'outcome',
  [
    z
      .object({ outcome: z.literal('succeeded'), ref: externalEventRefSchema })
      .strict(),
    z.object({ outcome: z.literal('unknown') }).strict(),
  ],
);

export const calendarMutationResultSchema = z.discriminatedUnion('outcome', [
  z
    .object({ outcome: z.literal('succeeded'), ref: calendarRefSchema })
    .strict(),
  z.object({ outcome: z.literal('unknown') }).strict(),
]);

export const externalDeletionResultSchema = z.discriminatedUnion('outcome', [
  z.object({ outcome: z.literal('succeeded') }).strict(),
  z.object({ outcome: z.literal('unknown') }).strict(),
]);

const reconciledEventSchema = z
  .object({
    ref: externalEventRefSchema,
    contentHash: nonEmptyString,
    startAt: instantSchema,
    endAt: instantSchema,
    ownershipVerified: z.literal(true),
  })
  .strict()
  .superRefine((event, context) => {
    if (Date.parse(event.endAt) <= Date.parse(event.startAt)) {
      context.addIssue({
        code: 'custom',
        message: 'Event end must be after start.',
        path: ['endAt'],
      });
    }
  });

export const appEventReconciliationSchema = z.discriminatedUnion('status', [
  reconciledEventSchema.extend({ status: z.literal('found') }).strict(),
  z.object({ status: z.literal('missing') }).strict(),
  z.object({ status: z.literal('unknown') }).strict(),
  reconciledEventSchema.extend({ status: z.literal('conflict') }).strict(),
]);

export const ownedCalendarEventCandidateSchema = reconciledEventSchema
  .extend({
    timeBlockId: nonEmptyString,
    planRevision: safeVersion,
  })
  .strict();

export const ownedCalendarEventInventorySchema = z.discriminatedUnion(
  'status',
  [
    z
      .object({
        status: z.enum(['complete', 'partial']),
        provider: nonEmptyString,
        calendarId: nonEmptyString,
        range: integrationTimeRangeSchema,
        events: z.array(ownedCalendarEventCandidateSchema),
      })
      .strict(),
    z.object({ status: z.literal('unknown') }).strict(),
  ],
);

export const calendarEventProjectionSchema = z
  .object({
    title: nonEmptyString,
    startAt: instantSchema,
    endAt: instantSchema,
  })
  .strict()
  .superRefine((event, context) => {
    if (Date.parse(event.endAt) <= Date.parse(event.startAt)) {
      context.addIssue({
        code: 'custom',
        message: 'Event end must be after start.',
        path: ['endAt'],
      });
    }
  })
  .nullable();

export const notificationIdentitySchema = z
  .object({
    timeBlockId: nonEmptyString,
    type: nonEmptyString,
  })
  .strict();

export const notificationRefSchema = z
  .object({
    osNotificationId: nonEmptyString,
    identity: notificationIdentitySchema,
  })
  .strict();

export const notificationMutationResultSchema = z.discriminatedUnion(
  'outcome',
  [
    z
      .object({ outcome: z.literal('succeeded'), ref: notificationRefSchema })
      .strict(),
    z.object({ outcome: z.literal('unknown') }).strict(),
  ],
);

export const notificationReconciliationSchema = z.discriminatedUnion('status', [
  z
    .object({
      status: z.literal('found'),
      ref: notificationRefSchema,
      contentHash: nonEmptyString,
      scheduledAt: instantSchema,
      identityVerified: z.literal(true),
    })
    .strict(),
  z.object({ status: z.literal('missing') }).strict(),
  z.object({ status: z.literal('unknown') }).strict(),
  z
    .object({
      status: z.literal('conflict'),
      ref: notificationRefSchema,
      contentHash: nonEmptyString,
      scheduledAt: instantSchema,
      identityVerified: z.literal(true),
    })
    .strict(),
]);

export const ownedNotificationCandidateSchema = z
  .object({
    planRevision: safeVersion,
    ref: notificationRefSchema,
    contentHash: nonEmptyString,
    scheduledAt: instantSchema,
    identityVerified: z.literal(true),
  })
  .strict();

export const ownedNotificationInventorySchema = z.discriminatedUnion('status', [
  z
    .object({
      status: z.enum(['complete', 'partial']),
      notifications: z.array(ownedNotificationCandidateSchema),
    })
    .strict(),
  z.object({ status: z.literal('unknown') }).strict(),
]);

export const notificationProjectionSchema = z
  .object({
    title: nonEmptyString,
    body: nullableNonEmptyString,
    scheduledAt: instantSchema,
    type: nonEmptyString,
  })
  .strict()
  .nullable();

export const calendarRefreshResultSchema = z
  .object({
    status: z.enum([
      'complete',
      'partial',
      'permission_required',
      'unavailable',
    ]),
    permission: calendarPermissionStateSchema,
    provider: nonEmptyString,
    calendarId: nonEmptyString,
    range: integrationTimeRangeSchema,
    fetchedAt: instantSchema.nullable(),
    upsertedCount: safeVersion,
    deletedCount: safeVersion,
    busyChanged: z.boolean(),
    stateVersion: safeVersion,
  })
  .strict();
