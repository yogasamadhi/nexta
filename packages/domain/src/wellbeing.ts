import { DomainError } from './errors';
import {
  parseCompletionRecordId,
  parseDailyReflectionId,
  parseEnergyCheckInId,
  parseInstant,
  parseLocalDate,
  parseRelaxSessionId,
  parseTaskId,
  parseTimeZoneId,
  requireNonEmptyString,
  requireNonNegativeInteger,
  type CompletionRecordId,
  type DailyReflectionId,
  type EnergyCheckInId,
  type Instant,
  type LocalDate,
  type RelaxSessionId,
  type TaskId,
  type TimeZoneId,
} from './value-objects';

export type ReflectionGeneratedBy = 'local_facts' | 'model_validated';

export type ReflectionWin = Readonly<{
  completionRecordId: CompletionRecordId;
  taskId: TaskId;
  title: string;
  completedAt: Instant;
}>;

export type DailyReflection = Readonly<{
  id: DailyReflectionId;
  localDate: LocalDate;
  timeZone: TimeZoneId;
  summary: string;
  wins: readonly ReflectionWin[];
  adjustmentSuggestion: string | null;
  userNote: string | null;
  generatedBy: ReflectionGeneratedBy;
  createdAt: Instant;
  updatedAt: Instant;
}>;

export type EnergyCheckInLevel = 1 | 2 | 3 | 4 | 5;

export type EnergyCheckIn = Readonly<{
  id: EnergyCheckInId;
  localDate: LocalDate;
  timeZone: TimeZoneId;
  level: EnergyCheckInLevel;
  note: string | null;
  createdAt: Instant;
}>;

export type RelaxType = 'breathing' | 'pause' | 'stretch' | 'ambient';
export type RelaxSource = 'relax_tab' | 'today' | 'focus';
export type RelaxStatus = 'active' | 'completed' | 'abandoned';
export type RelaxTimingQuality = 'trusted' | 'needs_review';

export type RelaxSession = Readonly<{
  id: RelaxSessionId;
  type: RelaxType;
  plannedMinutes: number;
  actualSeconds: number | null;
  startedAt: Instant;
  endedAt: Instant | null;
  source: RelaxSource;
  status: RelaxStatus;
  timingQuality: RelaxTimingQuality;
  createdAt: Instant;
}>;

function optionalText(value: string | null | undefined): string | null {
  if (value === null || value === undefined || value.trim() === '') return null;
  return value.trim();
}

function parseReflectionWin(win: ReflectionWin): ReflectionWin {
  return {
    completionRecordId: parseCompletionRecordId(win.completionRecordId),
    taskId: parseTaskId(win.taskId),
    title: requireNonEmptyString(win.title, 'Reflection win title'),
    completedAt: parseInstant(win.completedAt),
  };
}

export function assertValidDailyReflection(reflection: DailyReflection): void {
  parseDailyReflectionId(reflection.id);
  parseLocalDate(reflection.localDate);
  parseTimeZoneId(reflection.timeZone);
  requireNonEmptyString(reflection.summary, 'Reflection summary');
  if (!Array.isArray(reflection.wins) || reflection.wins.length > 3) {
    throw new DomainError(
      'invalid_value',
      'DailyReflection wins must contain at most three evidence items.',
    );
  }
  const identities = new Set<string>();
  for (const raw of reflection.wins) {
    const win = parseReflectionWin(raw);
    if (identities.has(win.completionRecordId)) {
      throw new DomainError(
        'invalid_value',
        'DailyReflection wins must not repeat completion evidence.',
      );
    }
    identities.add(win.completionRecordId);
  }
  if (
    reflection.adjustmentSuggestion !== null &&
    reflection.adjustmentSuggestion.trim().length === 0
  ) {
    throw new DomainError(
      'invalid_value',
      'Reflection adjustment suggestion must be non-empty or null.',
    );
  }
  if (reflection.userNote !== null) {
    if (
      typeof reflection.userNote !== 'string' ||
      reflection.userNote.trim().length === 0 ||
      reflection.userNote.length > 4_000
    ) {
      throw new DomainError(
        'invalid_value',
        'Reflection user note must be non-empty text of at most 4000 characters or null.',
      );
    }
  }
  if (
    reflection.generatedBy !== 'local_facts' &&
    reflection.generatedBy !== 'model_validated'
  ) {
    throw new DomainError(
      'invalid_value',
      'DailyReflection generatedBy is unsupported.',
    );
  }
  parseInstant(reflection.createdAt);
  parseInstant(reflection.updatedAt);
  if (Date.parse(reflection.updatedAt) < Date.parse(reflection.createdAt)) {
    throw new DomainError(
      'invalid_value',
      'DailyReflection updatedAt must not precede createdAt.',
    );
  }
}

export function createDailyReflection(input: {
  id: DailyReflectionId;
  localDate: LocalDate;
  timeZone: TimeZoneId;
  summary: string;
  wins: readonly ReflectionWin[];
  adjustmentSuggestion?: string | null;
  userNote?: string | null;
  generatedBy: ReflectionGeneratedBy;
  createdAt: Instant;
}): DailyReflection {
  const reflection: DailyReflection = {
    id: parseDailyReflectionId(input.id),
    localDate: parseLocalDate(input.localDate),
    timeZone: parseTimeZoneId(input.timeZone),
    summary: requireNonEmptyString(input.summary, 'Reflection summary'),
    wins: input.wins.map(parseReflectionWin),
    adjustmentSuggestion: optionalText(input.adjustmentSuggestion),
    userNote: optionalText(input.userNote),
    generatedBy: input.generatedBy,
    createdAt: parseInstant(input.createdAt),
    updatedAt: parseInstant(input.createdAt),
  };
  assertValidDailyReflection(reflection);
  return reflection;
}

export function updateDailyReflection(
  reflection: DailyReflection,
  patch: Readonly<{
    summary?: string;
    wins?: readonly ReflectionWin[];
    adjustmentSuggestion?: string | null;
    userNote?: string | null;
    generatedBy?: ReflectionGeneratedBy;
  }>,
  updatedAt: Instant,
): DailyReflection {
  assertValidDailyReflection(reflection);
  const next: DailyReflection = {
    ...reflection,
    summary:
      patch.summary === undefined
        ? reflection.summary
        : requireNonEmptyString(patch.summary, 'Reflection summary'),
    wins:
      patch.wins === undefined
        ? reflection.wins
        : patch.wins.map(parseReflectionWin),
    adjustmentSuggestion:
      patch.adjustmentSuggestion === undefined
        ? reflection.adjustmentSuggestion
        : optionalText(patch.adjustmentSuggestion),
    userNote:
      patch.userNote === undefined
        ? reflection.userNote
        : optionalText(patch.userNote),
    generatedBy: patch.generatedBy ?? reflection.generatedBy,
    updatedAt: parseInstant(updatedAt),
  };
  assertValidDailyReflection(next);
  return next;
}

export function assertValidEnergyCheckIn(checkIn: EnergyCheckIn): void {
  parseEnergyCheckInId(checkIn.id);
  parseLocalDate(checkIn.localDate);
  parseTimeZoneId(checkIn.timeZone);
  if (
    !Number.isInteger(checkIn.level) ||
    checkIn.level < 1 ||
    checkIn.level > 5
  ) {
    throw new DomainError(
      'invalid_value',
      'EnergyCheckIn level must be an integer from one to five.',
    );
  }
  if (checkIn.note !== null) {
    if (
      typeof checkIn.note !== 'string' ||
      checkIn.note.trim().length === 0 ||
      checkIn.note.length > 4_000
    ) {
      throw new DomainError(
        'invalid_value',
        'EnergyCheckIn note must be non-empty text of at most 4000 characters or null.',
      );
    }
  }
  parseInstant(checkIn.createdAt);
}

export function createEnergyCheckIn(input: {
  id: EnergyCheckInId;
  localDate: LocalDate;
  timeZone: TimeZoneId;
  level: EnergyCheckInLevel;
  note?: string | null;
  createdAt: Instant;
}): EnergyCheckIn {
  const checkIn: EnergyCheckIn = {
    id: parseEnergyCheckInId(input.id),
    localDate: parseLocalDate(input.localDate),
    timeZone: parseTimeZoneId(input.timeZone),
    level: input.level,
    note: optionalText(input.note),
    createdAt: parseInstant(input.createdAt),
  };
  assertValidEnergyCheckIn(checkIn);
  return checkIn;
}

export function assertValidRelaxSession(session: RelaxSession): void {
  parseRelaxSessionId(session.id);
  if (!['breathing', 'pause', 'stretch', 'ambient'].includes(session.type)) {
    throw new DomainError('invalid_value', 'RelaxSession type is unsupported.');
  }
  if (
    !Number.isSafeInteger(session.plannedMinutes) ||
    session.plannedMinutes <= 0 ||
    session.plannedMinutes > 60
  ) {
    throw new DomainError(
      'invalid_value',
      'RelaxSession plannedMinutes must be an integer from one to sixty.',
    );
  }
  parseInstant(session.startedAt);
  parseInstant(session.createdAt);
  if (!['relax_tab', 'today', 'focus'].includes(session.source)) {
    throw new DomainError(
      'invalid_value',
      'RelaxSession source is unsupported.',
    );
  }
  if (!['active', 'completed', 'abandoned'].includes(session.status)) {
    throw new DomainError(
      'invalid_value',
      'RelaxSession status is unsupported.',
    );
  }
  if (!['trusted', 'needs_review'].includes(session.timingQuality)) {
    throw new DomainError(
      'invalid_value',
      'RelaxSession timingQuality is unsupported.',
    );
  }
  if (session.status === 'active') {
    if (session.endedAt !== null || session.actualSeconds !== null) {
      throw new DomainError(
        'invalid_transition',
        'An active RelaxSession cannot contain an end or actual duration.',
      );
    }
  } else {
    if (session.endedAt === null || session.actualSeconds === null) {
      throw new DomainError(
        'invalid_transition',
        'A closed RelaxSession requires its end and actual duration.',
      );
    }
    parseInstant(session.endedAt);
    requireNonNegativeInteger(session.actualSeconds, 'actualSeconds');
    if (Date.parse(session.endedAt) < Date.parse(session.startedAt)) {
      throw new DomainError(
        'invalid_value',
        'RelaxSession endedAt must not precede startedAt.',
      );
    }
  }
}

export function startRelaxSession(input: {
  id: RelaxSessionId;
  type: RelaxType;
  plannedMinutes: number;
  source: RelaxSource;
  startedAt: Instant;
}): RelaxSession {
  const session: RelaxSession = {
    id: parseRelaxSessionId(input.id),
    type: input.type,
    plannedMinutes: input.plannedMinutes,
    actualSeconds: null,
    startedAt: parseInstant(input.startedAt),
    endedAt: null,
    source: input.source,
    status: 'active',
    timingQuality: 'trusted',
    createdAt: parseInstant(input.startedAt),
  };
  assertValidRelaxSession(session);
  return session;
}

export function endRelaxSession(
  session: RelaxSession,
  outcome: Exclude<RelaxStatus, 'active'>,
  requestedEndAt: Instant,
): RelaxSession {
  assertValidRelaxSession(session);
  if (session.status !== 'active') {
    throw new DomainError(
      'invalid_transition',
      'Only an active RelaxSession can be ended.',
    );
  }
  const parsedEnd = parseInstant(requestedEndAt);
  const clockMovedBackward =
    Date.parse(parsedEnd) < Date.parse(session.startedAt);
  const endedAt = clockMovedBackward ? session.startedAt : parsedEnd;
  const next: RelaxSession = {
    ...session,
    endedAt,
    actualSeconds: Math.max(
      0,
      Math.floor((Date.parse(endedAt) - Date.parse(session.startedAt)) / 1_000),
    ),
    status: outcome,
    timingQuality: clockMovedBackward ? 'needs_review' : 'trusted',
  };
  assertValidRelaxSession(next);
  return next;
}
