import {
  DomainError,
  claimIntegrationJob,
  createCalendarBinding,
  createCalendarContainerBinding,
  createCalendarRefreshCoverage,
  createExternalCalendarEventSnapshot,
  createExternalMutationIntent,
  createIntegrationJob,
  createNotificationBinding,
  externalCalendarEventIdentity,
  externalMutationIntentScopeKey,
  parseCalendarBindingId,
  parseCalendarContainerBindingId,
  parseCalendarRefreshCoverageId,
  parseExternalCalendarEventSnapshotId,
  parseExternalMutationIntentId,
  parseInstant,
  parseIntegrationJobId,
  parseNotificationBindingId,
  parseOperationId,
  parseSchedulePlanId,
  parseTaskId,
  parseTimeBlockId,
  requeueClaimedIntegrationJob,
  settleIntegrationJob,
} from '@workspace/domain';
import { describe, expect, it } from 'vitest';

const T0 = parseInstant('2026-09-12T08:00:00.000Z');
const T1 = parseInstant('2026-09-12T09:00:00.000Z');
const T2 = parseInstant('2026-09-12T10:00:00.000Z');

function expectDomainCode(work: () => unknown, code: DomainError['code']) {
  expect(work).toThrowError(expect.objectContaining({ code }));
}

function job() {
  return createIntegrationJob({
    id: parseIntegrationJobId('job-1'),
    operationId: parseOperationId('operation-1'),
    targetChannel: 'calendar',
    targetEntityType: 'schedule_plan',
    targetEntityId: parseSchedulePlanId('plan-1'),
    desiredRevision: 1,
    desiredAction: 'reconcile',
    createdAt: T0,
  });
}

describe('Phase 3 calendar facts', () => {
  it('keeps recurring event instance identity separate without storing content', () => {
    const first = createExternalCalendarEventSnapshot({
      id: parseExternalCalendarEventSnapshotId('snapshot-1'),
      provider: 'system',
      calendarId: 'calendar-1',
      externalEventId: 'event-1',
      occurrenceKey: ' occurrence-a ',
      startAt: T0,
      endAt: T1,
      busy: true,
      lastSeenAt: T2,
      contentHash: 'hash-a',
    });
    const second = createExternalCalendarEventSnapshot({
      ...first,
      id: parseExternalCalendarEventSnapshotId('snapshot-2'),
      occurrenceKey: 'occurrence-b',
    });

    expect(first.occurrenceKey).toBe('occurrence-a');
    expect(externalCalendarEventIdentity(first)).not.toBe(
      externalCalendarEventIdentity(second),
    );
    expectDomainCode(
      () =>
        createExternalCalendarEventSnapshot({
          ...first,
          startAt: T1,
          endAt: T1,
        }),
      'invalid_value',
    );
  });

  it('only permits complete refresh attempts to become range coverage', () => {
    expect(
      createCalendarRefreshCoverage({
        id: parseCalendarRefreshCoverageId('coverage-1'),
        provider: 'system',
        calendarId: 'calendar-1',
        rangeStart: T0,
        rangeEnd: T2,
        fetchedAt: T1,
        completeness: 'complete',
        observedEventCount: 2,
      }),
    ).toMatchObject({ completeness: 'complete', observedEventCount: 2 });
    expectDomainCode(
      () =>
        createCalendarRefreshCoverage({
          id: parseCalendarRefreshCoverageId('coverage-2'),
          provider: 'system',
          calendarId: 'calendar-1',
          rangeStart: T0,
          rangeEnd: T2,
          fetchedAt: T1,
          completeness: 'partial' as never,
          observedEventCount: 1,
        }),
      'invalid_value',
    );
  });
});

describe('Phase 3 verified integration bindings', () => {
  it('requires verified ownership for calendar containers and events', () => {
    expectDomainCode(
      () =>
        createCalendarContainerBinding({
          id: parseCalendarContainerBindingId('container-1'),
          provider: 'system',
          calendarId: 'calendar-1',
          ownershipKey: 'app-calendar',
          ownershipVerified: false as never,
          status: 'synced',
          verifiedAt: T1,
          createdAt: T0,
        }),
      'invariant_violation',
    );
    expectDomainCode(
      () =>
        createCalendarBinding({
          id: parseCalendarBindingId('binding-1'),
          timeBlockId: parseTimeBlockId('block-1'),
          provider: 'system',
          calendarId: 'calendar-1',
          externalEventId: 'event-1',
          occurrenceKey: null,
          ownershipKey: 'app-calendar',
          ownershipVerified: false as never,
          appliedContentHash: 'hash-1',
          appliedStartAt: T0,
          appliedEndAt: T1,
          lastAppliedRevision: 1,
          status: 'synced',
          verifiedAt: T1,
          createdAt: T0,
        }),
      'invariant_violation',
    );
  });

  it('uses the stable notification block/type identity and fences revisions', () => {
    const binding = createNotificationBinding({
      id: parseNotificationBindingId('notification-binding-1'),
      timeBlockId: parseTimeBlockId('block-1'),
      taskId: parseTaskId('task-1'),
      osNotificationId: 'notification-1',
      type: 'start_reminder',
      appliedContentHash: 'hash-1',
      scheduledAt: T1,
      desiredRevision: 2,
      lastAppliedRevision: 1,
      status: 'pending',
      identityVerified: true,
      verifiedAt: T1,
      createdAt: T0,
    });
    expect(binding).toMatchObject({
      timeBlockId: 'block-1',
      type: 'start_reminder',
      desiredRevision: 2,
      lastAppliedRevision: 1,
    });
    expectDomainCode(
      () =>
        createNotificationBinding({
          ...binding,
          status: 'synced',
        }),
      'invariant_violation',
    );
  });
});

describe('Phase 3 IntegrationJob recovery fence', () => {
  it('claims with a lease and settles only the matching attempt generation', () => {
    const claimed = claimIntegrationJob(job(), {
      claimToken: 'claim-1',
      claimedAt: T1,
      leaseExpiresAt: T2,
    });
    expect(claimed).toMatchObject({
      status: 'processing',
      attemptCount: 1,
      automaticRetryEligible: true,
      claimToken: 'claim-1',
      leaseExpiresAt: T2,
      notBefore: T0,
    });
    const settled = settleIntegrationJob(claimed, {
      claimToken: 'claim-1',
      attemptCount: 1,
      status: 'superseded',
      updatedAt: T2,
    });
    expect(settled).toMatchObject({
      status: 'superseded',
      automaticRetryEligible: false,
      claimToken: null,
      leaseExpiresAt: null,
    });
    expectDomainCode(
      () =>
        settleIntegrationJob(claimed, {
          claimToken: 'other-claim',
          attemptCount: 1,
          status: 'succeeded',
          updatedAt: T2,
        }),
      'invalid_transition',
    );
  });

  it('rejects a rehydrated processing row whose lease is already expired', () => {
    expectDomainCode(
      () =>
        createIntegrationJob({
          ...job(),
          status: 'processing',
          claimToken: 'claim-1',
          leaseExpiresAt: T1,
          updatedAt: T1,
        }),
      'invariant_violation',
    );
  });

  it('can release the matching claim back to pending when its fact snapshot changes', () => {
    const claimed = claimIntegrationJob(job(), {
      claimToken: 'claim-1',
      claimedAt: T1,
      leaseExpiresAt: T2,
    });

    expect(
      requeueClaimedIntegrationJob(claimed, {
        claimToken: 'claim-1',
        attemptCount: 1,
        updatedAt: T2,
      }),
    ).toMatchObject({
      status: 'pending',
      attemptCount: 1,
      automaticRetryEligible: true,
      claimToken: null,
      leaseExpiresAt: null,
      notBefore: T2,
    });
    expectDomainCode(
      () =>
        requeueClaimedIntegrationJob(claimed, {
          claimToken: 'stale-claim',
          attemptCount: 1,
          updatedAt: T2,
        }),
      'invalid_transition',
    );
  });

  it('does not automatically reclaim reconciliation work that needs an explicit recovery action', () => {
    const blocked = createIntegrationJob({
      ...job(),
      status: 'reconciliation_required',
      lastErrorCode: 'calendar_provisioning_unknown',
      automaticRetryEligible: false,
    });

    expect(blocked.automaticRetryEligible).toBe(false);
    expectDomainCode(
      () =>
        claimIntegrationJob(blocked, {
          claimToken: 'claim-2',
          claimedAt: T1,
          leaseExpiresAt: T2,
        }),
      'invalid_transition',
    );
  });
});

describe('Phase 3 durable external mutation intents', () => {
  it('uses the same stable scope across jobs and calendar event actions', () => {
    const payload = {
      provider: 'system',
      calendarId: 'calendar-1',
      ownershipKey: 'owned-calendar',
      timeBlockId: parseTimeBlockId('block-1'),
      searchStartAt: T0,
      searchEndAt: T1,
      externalEventId: 'event-1',
      occurrenceKey: null,
      expectedContentHash: 'old-hash',
      desiredContentHash: 'new-hash',
      desiredStartAt: T1,
      desiredEndAt: T2,
    } as const;
    const intent = createExternalMutationIntent({
      id: parseExternalMutationIntentId('intent-1'),
      integrationJobId: parseIntegrationJobId('job-1'),
      desiredRevision: 2,
      action: 'calendar_event_update',
      payload,
      createdAt: T0,
    });

    expect(intent.scopeKey).toBe(
      externalMutationIntentScopeKey('calendar_event_delete', {
        ...payload,
        desiredContentHash: null,
        desiredStartAt: null,
        desiredEndAt: null,
      }),
    );
    expect(intent.scopeKey).toBe(
      JSON.stringify(['calendar_event', 'system', 'calendar-1', 'block-1']),
    );
  });

  it('rejects an intent whose action does not match its recovery payload', () => {
    expectDomainCode(
      () =>
        createExternalMutationIntent({
          id: parseExternalMutationIntentId('intent-invalid'),
          integrationJobId: parseIntegrationJobId('job-1'),
          desiredRevision: 1,
          action: 'calendar_event_create',
          payload: {
            provider: 'system',
            calendarId: 'calendar-1',
            ownershipKey: 'owned-calendar',
            timeBlockId: parseTimeBlockId('block-1'),
            searchStartAt: T0,
            searchEndAt: T1,
            externalEventId: 'event-1',
            occurrenceKey: null,
            expectedContentHash: null,
            desiredContentHash: 'hash-1',
            desiredStartAt: T0,
            desiredEndAt: T1,
          },
          createdAt: T0,
        }),
      'invariant_violation',
    );
  });
});
