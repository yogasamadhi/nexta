import { describe, expect, it } from 'vitest';

import {
  assertValidIntegrationJob,
  assertValidSchedulePlan,
  createCommittedSchedulePlan,
  createIntegrationJob,
  createTimeBlock,
  DomainError,
  integrationJobChannels,
  integrationJobStatuses,
  parseInstant,
  parseIntegrationJobId,
  parseOperationId,
  parseSchedulePlanId,
  parseTaskId,
  parseTimeBlockId,
  parseTimeZoneId,
  timeBlockStatuses,
  timeBlockTypes,
  type IntegrationJob,
  type SchedulePlan,
  type TimeBlock,
} from '../../../packages/domain/src';

const T0 = parseInstant('2026-09-12T00:00:00.000Z');
const T1 = parseInstant('2026-09-12T01:00:00.000Z');
const T2 = parseInstant('2026-09-12T02:00:00.000Z');

function expectDomainCode(
  action: () => unknown,
  code: DomainError['code'],
): void {
  try {
    action();
    throw new Error('Expected a DomainError.');
  } catch (error) {
    expect(error).toBeInstanceOf(DomainError);
    expect((error as DomainError).code).toBe(code);
  }
}

function makeTimeBlock(
  overrides: Partial<Parameters<typeof createTimeBlock>[0]> = {},
): TimeBlock {
  return createTimeBlock({
    id: parseTimeBlockId('block-1'),
    taskId: parseTaskId('task-1'),
    type: 'task',
    startAt: T1,
    endAt: T2,
    status: 'planned',
    source: 'scheduler',
    locked: false,
    planRevision: 1,
    createdAt: T0,
    ...overrides,
  });
}

function makeSchedulePlan(
  overrides: Partial<Parameters<typeof createCommittedSchedulePlan>[0]> = {},
): SchedulePlan {
  return createCommittedSchedulePlan({
    id: parseSchedulePlanId('plan-1'),
    planRevision: 1,
    basedOnStateVersion: 3,
    createdAt: T0,
    committedAt: T1,
    inputHash: 'sha256:input',
    schedulerVersion: 'scheduler-v1',
    policyVersion: 'policy-v1',
    timeZone: parseTimeZoneId('Asia/Shanghai'),
    horizonStart: T1,
    horizonEnd: T2,
    reason: 'initial_plan',
    ...overrides,
  });
}

function makeIntegrationJob(
  overrides: Partial<Parameters<typeof createIntegrationJob>[0]> = {},
): IntegrationJob {
  return createIntegrationJob({
    id: parseIntegrationJobId('job-1'),
    operationId: parseOperationId('operation-1'),
    targetChannel: 'calendar',
    targetEntityType: 'schedule_plan',
    targetEntityId: parseSchedulePlanId('plan-1'),
    desiredRevision: 1,
    desiredAction: 'reconcile',
    createdAt: T1,
    ...overrides,
  });
}

describe('Phase 2 identifiers', () => {
  it('normalizes each scheduling identifier and rejects blank values', () => {
    expect(parseTimeBlockId(' block-1 ')).toBe('block-1');
    expect(parseSchedulePlanId(' plan-1 ')).toBe('plan-1');
    expect(parseIntegrationJobId(' job-1 ')).toBe('job-1');

    for (const parseId of [
      parseTimeBlockId,
      parseSchedulePlanId,
      parseIntegrationJobId,
    ]) {
      expectDomainCode(() => parseId('   '), 'invalid_value');
    }
  });
});

describe('TimeBlock', () => {
  it('publishes the complete type and status vocabularies', () => {
    expect(timeBlockTypes).toEqual(['task', 'break', 'relax', 'buffer']);
    expect(timeBlockStatuses).toEqual([
      'planned',
      'started',
      'completed',
      'skipped',
      'canceled',
    ]);
  });

  it('creates a task block without conflating it with its Task', () => {
    const block = makeTimeBlock({
      source: ' scheduler ',
      externalCalendarEventId: ' event-1 ',
    });

    expect(block).toMatchObject({
      id: 'block-1',
      taskId: 'task-1',
      type: 'task',
      source: 'scheduler',
      status: 'planned',
      externalCalendarEventId: 'event-1',
      updatedAt: T0,
    });
  });

  it.each(timeBlockTypes.filter((type) => type !== 'task'))(
    'allows a %s block without a Task reference',
    (type) => {
      expect(makeTimeBlock({ type, taskId: null }).taskId).toBeNull();
    },
  );

  it('requires a task block to reference a Task', () => {
    expectDomainCode(
      () => makeTimeBlock({ taskId: null }),
      'invariant_violation',
    );
  });

  it.each([
    ['type', 'meeting'],
    ['status', 'draft'],
  ] as const)('rejects an unsupported %s enum value', (field, value) => {
    expectDomainCode(
      () => makeTimeBlock({ [field]: value } as never),
      'invalid_value',
    );
  });

  it('uses a non-empty half-open interval', () => {
    expect(makeTimeBlock()).toMatchObject({ startAt: T1, endAt: T2 });
    expectDomainCode(
      () => makeTimeBlock({ startAt: T1, endAt: T1 }),
      'invariant_violation',
    );
    expectDomainCode(
      () => makeTimeBlock({ startAt: T2, endAt: T1 }),
      'invariant_violation',
    );
  });

  it('accepts an initial zero revision and rejects invalid revisions', () => {
    expect(makeTimeBlock({ planRevision: 0 }).planRevision).toBe(0);

    for (const planRevision of [-1, 0.5, Number.MAX_SAFE_INTEGER + 1]) {
      expectDomainCode(() => makeTimeBlock({ planRevision }), 'invalid_value');
    }
  });

  it('validates source, lock state, and an optional external event reference', () => {
    expect(makeTimeBlock({ externalCalendarEventId: null })).toMatchObject({
      locked: false,
      externalCalendarEventId: null,
    });
    expectDomainCode(() => makeTimeBlock({ source: ' ' }), 'invalid_value');
    expectDomainCode(
      () => makeTimeBlock({ locked: 'false' as never }),
      'invalid_value',
    );
    expectDomainCode(
      () => makeTimeBlock({ externalCalendarEventId: ' ' }),
      'invalid_value',
    );
  });

  it('does not reject a clock rollback between createdAt and updatedAt', () => {
    const block = makeTimeBlock({ createdAt: T2, updatedAt: T1 });

    expect(block.createdAt).toBe(T2);
    expect(block.updatedAt).toBe(T1);
  });
});

describe('SchedulePlan', () => {
  it('creates only a committed persisted plan with normalized metadata', () => {
    const plan = makeSchedulePlan({
      inputHash: ' sha256:input ',
      schedulerVersion: ' scheduler-v1 ',
      policyVersion: ' policy-v1 ',
      reason: ' initial_plan ',
    });

    expect(plan).toMatchObject({
      id: 'plan-1',
      planRevision: 1,
      basedOnStateVersion: 3,
      status: 'committed',
      inputHash: 'sha256:input',
      schedulerVersion: 'scheduler-v1',
      policyVersion: 'policy-v1',
      timeZone: 'Asia/Shanghai',
      reason: 'initial_plan',
    });
  });

  it('requires a positive safe-integer planRevision', () => {
    for (const planRevision of [
      0,
      -1,
      1.5,
      Number.MAX_SAFE_INTEGER + 1,
      Number.POSITIVE_INFINITY,
    ]) {
      expectDomainCode(
        () => makeSchedulePlan({ planRevision }),
        'invalid_value',
      );
    }
  });

  it('requires a non-negative safe-integer base state version', () => {
    for (const basedOnStateVersion of [-1, 1.5]) {
      expectDomainCode(
        () => makeSchedulePlan({ basedOnStateVersion }),
        'invalid_value',
      );
    }
  });

  it('requires a finite non-empty scheduling horizon', () => {
    expect(makeSchedulePlan()).toMatchObject({
      horizonStart: T1,
      horizonEnd: T2,
    });
    expectDomainCode(
      () => makeSchedulePlan({ horizonStart: T1, horizonEnd: T1 }),
      'invariant_violation',
    );
    expectDomainCode(
      () => makeSchedulePlan({ horizonStart: T2, horizonEnd: T1 }),
      'invariant_violation',
    );
  });

  it('rejects a non-committed persisted status from an untyped caller', () => {
    const plan = makeSchedulePlan();

    expectDomainCode(
      () =>
        assertValidSchedulePlan({
          ...plan,
          status: 'preview' as never,
        }),
      'invalid_value',
    );
  });

  it.each([
    'inputHash',
    'schedulerVersion',
    'policyVersion',
    'reason',
  ] as const)('rejects blank %s metadata', (field) => {
    expectDomainCode(() => makeSchedulePlan({ [field]: ' ' }), 'invalid_value');
  });
});

describe('IntegrationJob', () => {
  it('publishes all supported targets and lifecycle statuses', () => {
    expect(integrationJobChannels).toEqual(['calendar', 'notification']);
    expect(integrationJobStatuses).toEqual([
      'pending',
      'processing',
      'succeeded',
      'permission_required',
      'failed',
      'reconciliation_required',
      'disabled',
      'superseded',
    ]);
  });

  it('defaults a new reconcile job to pending with no invented attempt', () => {
    expect(makeIntegrationJob()).toMatchObject({
      id: 'job-1',
      operationId: 'operation-1',
      targetChannel: 'calendar',
      targetEntityType: 'schedule_plan',
      targetEntityId: 'plan-1',
      desiredRevision: 1,
      desiredAction: 'reconcile',
      status: 'pending',
      attemptCount: 0,
      lastErrorCode: null,
      updatedAt: T1,
    });
  });

  it.each(integrationJobChannels)(
    'accepts the %s integration target',
    (targetChannel) => {
      expect(makeIntegrationJob({ targetChannel }).targetChannel).toBe(
        targetChannel,
      );
    },
  );

  it.each(integrationJobStatuses)(
    'accepts the %s lifecycle status',
    (status) => {
      expect(
        makeIntegrationJob({
          status,
          ...(status === 'processing'
            ? {
                claimToken: 'claim-1',
                leaseExpiresAt: T2,
              }
            : {}),
        }).status,
      ).toBe(status);
    },
  );

  it.each([
    ['targetChannel', 'email'],
    ['targetEntityType', 'task'],
    ['desiredAction', 'create'],
    ['status', 'complete'],
  ] as const)('rejects unsupported %s value', (field, value) => {
    expectDomainCode(
      () => makeIntegrationJob({ [field]: value } as never),
      'invalid_value',
    );
  });

  it('requires non-negative safe-integer desired revision and attempt count', () => {
    for (const desiredRevision of [-1, 0.5]) {
      expectDomainCode(
        () => makeIntegrationJob({ desiredRevision }),
        'invalid_value',
      );
    }
    for (const attemptCount of [-1, 0.5, Number.MAX_SAFE_INTEGER + 1]) {
      expectDomainCode(
        () => makeIntegrationJob({ attemptCount }),
        'invalid_value',
      );
    }
  });

  it('preserves a non-empty adapter error code', () => {
    expect(
      makeIntegrationJob({
        status: 'failed',
        attemptCount: 2,
        lastErrorCode: ' calendar_unavailable ',
      }),
    ).toMatchObject({
      status: 'failed',
      attemptCount: 2,
      lastErrorCode: 'calendar_unavailable',
    });
    expectDomainCode(
      () => makeIntegrationJob({ lastErrorCode: ' ' }),
      'invalid_value',
    );
  });

  it('validates the target plan identifier when rehydrating a job', () => {
    const job = makeIntegrationJob();

    expectDomainCode(
      () =>
        assertValidIntegrationJob({
          ...job,
          targetEntityId: ' ' as never,
        }),
      'invalid_value',
    );
  });

  it('does not reject a clock rollback between createdAt and updatedAt', () => {
    const job = makeIntegrationJob({ createdAt: T2, updatedAt: T1 });

    expect(job.createdAt).toBe(T2);
    expect(job.updatedAt).toBe(T1);
  });
});
