import type {
  ScheduleTimeRange,
  SchedulingWorkingHoursRule,
  UtcWorkingWindowPort,
} from '@workspace/application';
import type { TimeZoneId } from '@workspace/domain';

import { IntlTemporalAdapter } from './intl-temporal-adapter';

export class IntlUtcWorkingWindowPort implements UtcWorkingWindowPort {
  constructor(private readonly temporal: IntlTemporalAdapter) {}

  listUtcWorkingWindows(
    range: ScheduleTimeRange,
    timeZone: TimeZoneId,
    rules: readonly SchedulingWorkingHoursRule[],
  ) {
    return Promise.resolve(
      this.temporal
        .expandWorkingHours({
          range,
          timeZone,
          rules,
        })
        .map(({ id, start, end, energyLevel }) => ({
          id,
          start,
          end,
          energyLevel,
        })),
    );
  }
}
