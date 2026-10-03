import { DomainError } from './errors';
import { requireNonNegativeInteger } from './value-objects';

export interface ScheduleState {
  readonly stateVersion: number;
  readonly planRevision: number;
}

export interface CreateScheduleStateFields {
  readonly stateVersion?: number;
  readonly planRevision?: number;
}

export function createScheduleState(
  input: CreateScheduleStateFields = {},
): ScheduleState {
  return {
    stateVersion: requireNonNegativeInteger(
      input.stateVersion ?? 0,
      'stateVersion',
    ),
    planRevision: requireNonNegativeInteger(
      input.planRevision ?? 0,
      'planRevision',
    ),
  };
}

function incrementVersion(value: number, field: string): number {
  requireNonNegativeInteger(value, field);
  if (value === Number.MAX_SAFE_INTEGER) {
    throw new DomainError('invariant_violation', `${field} is exhausted.`, {
      field,
    });
  }
  return value + 1;
}

export function advanceStateVersion(state: ScheduleState): ScheduleState {
  createScheduleState(state);
  return {
    ...state,
    stateVersion: incrementVersion(state.stateVersion, 'stateVersion'),
  };
}

export function advancePlanRevision(state: ScheduleState): ScheduleState {
  createScheduleState(state);
  return {
    ...state,
    planRevision: incrementVersion(state.planRevision, 'planRevision'),
  };
}
