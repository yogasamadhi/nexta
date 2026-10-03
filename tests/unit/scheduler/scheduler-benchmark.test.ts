import { previewSchedule, replanSchedule } from '@workspace/scheduler-core';
import { describe, expect, it } from 'vitest';

import {
  assertFeasible,
  planChanges,
} from '../../benchmarks/scheduler/analysis';
import {
  createScenario,
  replanInput,
} from '../../benchmarks/scheduler/scenarios';

describe('scheduler benchmark evidence', () => {
  it('uses repeatable workloads and verifies actual preview/replan postconditions', () => {
    const first = createScenario(50, 7, 'dense');
    expect(createScenario(50, 7, 'dense')).toEqual(first);
    const preview = previewSchedule(first.input);
    assertFeasible(first.input, preview);
    const changed = replanInput(first.input, preview);
    assertFeasible(changed, replanSchedule(changed));
    expect(previewSchedule(first.input)).toEqual(preview);
  });

  it('rejects an apparently successful result that alters a protected fact', () => {
    const { input } = createScenario(50, 7, 'sparse');
    const result = previewSchedule(input);
    const broken = {
      ...result,
      blocks: result.blocks.filter((b) => b.existingBlockId !== 'locked-block'),
    };
    expect(() => assertFeasible(input, broken)).toThrow(
      'protected block missing',
    );
  });

  it('separates creations/removals from identity-matched movement and resizing', () => {
    const { input } = createScenario(50, 7, 'sparse');
    const result = previewSchedule(input);
    const source = input.existingBlocks[0];
    const block = result.blocks.find((b) => b.existingBlockId === source?.id);
    if (!source || !block) throw new Error('Missing fixture');
    const next = {
      ...block,
      start: '2026-10-05T02:30:00.000Z',
      end: '2026-10-05T04:00:00.000Z',
    };
    const added = {
      ...block,
      existingBlockId: null,
      stableKey: 'new-identity',
    };
    const delta = planChanges(input, { ...result, blocks: [next, added] });
    expect(delta).toEqual({
      added: 1,
      removed: 2,
      moved: 1,
      resized: 1,
      unchanged: 0,
      totalStartOffsetMinutes: 30,
    });
  });
});
