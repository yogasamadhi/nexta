import { describe, it, expect } from 'vitest';
import { cloudBatchSchema, cloudEntitySchema } from '@workspace/application';
import fixture from '../../../server/contracts/fixtures.json';
describe('shared cloud protocol v1', () => {
  it('accepts the complete portable graph shared with Go', () => {
    expect(cloudBatchSchema.parse(fixture).changes).toHaveLength(15);
  });
  it('rejects OS identities, unknown kinds, and malformed versions', () => {
    const entity = fixture.changes.find((e) => e.kind === 'time_block')!;
    expect(
      cloudEntitySchema.safeParse({
        ...entity,
        value: { ...entity.value, externalCalendarEventId: 'external' },
      }).success,
    ).toBe(false);
    expect(
      cloudEntitySchema.safeParse({ ...entity, version: '00' }).success,
    ).toBe(false);
    expect(
      cloudEntitySchema.safeParse({ ...entity, kind: 'operation_records' })
        .success,
    ).toBe(false);
  });
});
