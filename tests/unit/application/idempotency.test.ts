import { describe, expect, it } from 'vitest';

import {
  ApplicationError,
  canonicalizeOperationParameters,
  hashOperationParameters,
  replayStoredOperation,
} from '@workspace/application';

describe('operation parameter identity', () => {
  it('canonicalizes object keys while preserving array order', () => {
    const first = {
      title: 'Write proposal',
      scheduling: { deadline: null, windows: ['morning', 'afternoon'] },
    };
    const reordered = {
      scheduling: { windows: ['morning', 'afternoon'], deadline: null },
      title: 'Write proposal',
    };

    expect(canonicalizeOperationParameters(first)).toBe(
      canonicalizeOperationParameters(reordered),
    );
    expect(hashOperationParameters(first)).toBe(
      hashOperationParameters(reordered),
    );
    expect(hashOperationParameters({ values: [1, 2] })).not.toBe(
      hashOperationParameters({ values: [2, 1] }),
    );
  });

  it('uses a stable SHA-256 digest without retaining the input payload', () => {
    expect(hashOperationParameters({ a: 1, b: '步迹' })).toBe(
      'sha256:4420464c9923386ff9bbb4dae413d5e940c07b84eed63ff89f786aa1dc476f01',
    );
    expect(hashOperationParameters(null)).toBe(
      'sha256:74234e98afe7498fb5daf1f36ac2d78acc339464f950703b8c019892f982b90b',
    );
    expect(hashOperationParameters('😀')).toBe(
      'sha256:7a0c50b92434b015545fe93ab723db2d4b2cdd14a441405624a9ce8be29f1d5a',
    );
  });

  it.each([
    { label: 'undefined', value: { value: undefined } },
    { label: 'non-finite number', value: { value: Number.NaN } },
    { label: 'non-plain object', value: { value: new Date(0) } },
    { label: 'sparse array', value: Array(1) },
  ])('rejects $label rather than creating an ambiguous digest', ({ value }) => {
    expect(() => hashOperationParameters(value)).toThrowError(
      expect.objectContaining({ code: 'validation_error' }),
    );
  });

  it('rejects cyclic input', () => {
    const input: Record<string, unknown> = {};
    input.self = input;

    expect(() => hashOperationParameters(input)).toThrowError(
      expect.objectContaining({ code: 'validation_error' }),
    );
  });

  it('rejects fields that JSON would silently ignore', () => {
    const withExtraField = [1] as number[] & { extra?: number };
    withExtraField.extra = 2;
    const withAccessor = Object.defineProperty({}, 'value', {
      enumerable: true,
      get: () => 1,
    });

    expect(() => hashOperationParameters(withExtraField)).toThrowError(
      expect.objectContaining({ code: 'validation_error' }),
    );
    expect(() => hashOperationParameters(withAccessor)).toThrowError(
      expect.objectContaining({ code: 'validation_error' }),
    );
  });
});

describe('operation replay', () => {
  const requested = {
    operationId: 'operation-1',
    command: 'task.create',
    parameterHash: 'sha256:parameters',
  } as const;

  it('returns the committed result for the same command and input', () => {
    const result = { taskId: 'task-1' };

    expect(
      replayStoredOperation(
        {
          ...requested,
          result,
        },
        requested,
      ),
    ).toBe(result);
  });

  it('returns undefined when the operation has not been committed', () => {
    expect(replayStoredOperation(undefined, requested)).toBeUndefined();
  });

  it.each([
    {
      operationId: 'operation-2',
      command: requested.command,
      parameterHash: requested.parameterHash,
    },
    { command: 'task.update', parameterHash: requested.parameterHash },
    { command: requested.command, parameterHash: 'sha256:other' },
  ])('rejects reuse for different identity %#', (differentIdentity) => {
    const differentRequest = {
      operationId: requested.operationId,
      ...differentIdentity,
    };

    expect(() =>
      replayStoredOperation(
        {
          ...requested,
          result: { taskId: 'task-1' },
        },
        differentRequest,
      ),
    ).toThrowError(
      expect.objectContaining({
        code: 'idempotency_conflict',
        retryable: false,
        operationId: differentRequest.operationId,
      }),
    );
  });

  it('exposes a sanitized application error payload', () => {
    const error = new ApplicationError(
      'adapter_error',
      'Adapter unavailable.',
      {
        retryable: true,
        causeCategory: 'temporary_io',
        operationId: 'operation-2',
      },
    );

    expect(error.toPayload()).toEqual({
      code: 'adapter_error',
      message: 'Adapter unavailable.',
      retryable: true,
      causeCategory: 'temporary_io',
      operationId: 'operation-2',
    });
    expect(error.toPayload()).not.toHaveProperty('stack');
    expect(error.toPayload()).not.toHaveProperty('cause');
  });
});
