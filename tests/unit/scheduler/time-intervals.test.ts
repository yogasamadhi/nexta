import { expect, it } from 'vitest';

import { subtractIntervals } from '../../../packages/scheduler-core/src/time';

it('subtracts the exact occupied union without outside or touching intervals changing free capacity', () => {
  let seed = 20261003;
  const random = (limit: number) => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed % limit;
  };
  for (let trial = 0; trial < 200; trial += 1) {
    const container = { start: 10 + random(20), end: 60 + random(20) };
    const occupied = Array.from({ length: 150 }, () => {
      const start = random(300) - 100;
      return { start, end: start + 1 + random(12) };
    });
    occupied.push(
      { start: container.start - 10, end: container.start },
      { start: container.end, end: container.end + 10 },
    );
    const original = JSON.stringify(occupied);
    // Independent discrete-unit oracle: fixtures have integer boundaries.
    const expected: { start: number; end: number }[] = [];
    for (let point = container.start; point < container.end; point += 1) {
      if (occupied.some((i) => i.start <= point && point < i.end)) continue;
      const previous = expected[expected.length - 1];
      if (previous?.end === point) previous.end = point + 1;
      else expected.push({ start: point, end: point + 1 });
    }
    expect(subtractIntervals(container, occupied)).toEqual(expected);
    expect(JSON.stringify(occupied)).toBe(original);
  }
});
