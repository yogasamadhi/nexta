import type {
  LocalDayRangePort,
  ScheduleTimeRange,
} from '@workspace/application';

import { IntlTemporalAdapter } from './intl-temporal-adapter';

export class IntlLocalDayRangePort implements LocalDayRangePort {
  constructor(private readonly temporal: IntlTemporalAdapter) {}

  dayRange(input: Parameters<LocalDayRangePort['dayRange']>[0]) {
    return Promise.resolve(
      this.temporal.dayRange({
        localDate: input.localDate,
        timeZone: input.timeZone,
      }) satisfies ScheduleTimeRange,
    );
  }
}
