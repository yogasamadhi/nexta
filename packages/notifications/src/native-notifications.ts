export type NativeNotificationPermissionResponse = Readonly<{
  status: string;
  granted: boolean;
  canAskAgain: boolean;
  iosAuthorizationStatus?: number;
}>;

export type NativeNotificationPermissionRequest = Readonly<{
  allowAlert: boolean;
  allowBadge: boolean;
  allowSound: boolean;
}>;

export type NativeNotificationChannel = Readonly<{
  id: string;
  name: string;
  importance: number;
  description?: string;
  sound?: string | null;
  vibrationPattern?: readonly number[];
}>;

export type NativeNotificationContent = Readonly<{
  title: string;
  body?: string;
  data: Readonly<Record<string, unknown>>;
}>;

/**
 * Absolute trigger observation normalized at the native boundary. Relative or
 * platform-specific shapes are deliberately not guessed.
 */
export type NativeNotificationTrigger =
  | Readonly<{ kind: 'date'; scheduledAt: string }>
  | Readonly<{ kind: 'unknown' }>;

export type NativeNotificationRequest = Readonly<{
  identifier: string;
  content: NativeNotificationContent;
  trigger: NativeNotificationTrigger;
}>;

export type NativeScheduleNotificationInput = Readonly<{
  identifier: string;
  content: NativeNotificationContent;
  scheduledAt: Date;
  channelId?: string;
}>;

function canonicalAbsoluteTrigger(value: unknown): string | null {
  let milliseconds: number;
  if (value instanceof Date) {
    milliseconds = value.getTime();
  } else if (typeof value === 'number') {
    // Expo's Date trigger API and Android `value` representation use epoch
    // milliseconds. Never infer seconds from magnitude.
    milliseconds = value;
  } else if (typeof value === 'string') {
    if (
      value.trim() !== value ||
      !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?(?:Z|[+-]\d{2}:\d{2})$/i.test(
        value,
      )
    ) {
      return null;
    }
    milliseconds = Date.parse(value);
  } else {
    return null;
  }
  if (!Number.isFinite(milliseconds)) return null;
  try {
    return new Date(milliseconds).toISOString();
  } catch {
    return null;
  }
}

/**
 * Normalizes known Expo date-trigger representations:
 * - public Date / epoch-millisecond / explicit-zone ISO values;
 * - `{ type: 'date', date }` input-like values;
 * - Android `{ type: 'date', value }` readback;
 * - native `{ type: 'date', timestamp }` values.
 *
 * Relative timeInterval and calendar/platform-specific shapes cannot prove an
 * absolute scheduled instant after a process restart and remain unknown.
 */
export function normalizeNativeNotificationTrigger(
  input: unknown,
): NativeNotificationTrigger {
  const direct = canonicalAbsoluteTrigger(input);
  if (direct !== null) return { kind: 'date', scheduledAt: direct };
  if (typeof input !== 'object' || input === null || Array.isArray(input)) {
    return { kind: 'unknown' };
  }
  const trigger = input as Record<string, unknown>;
  if (trigger.type !== 'date') return { kind: 'unknown' };
  if (
    trigger.repeats !== undefined &&
    (typeof trigger.repeats !== 'boolean' || trigger.repeats)
  ) {
    return { kind: 'unknown' };
  }

  const candidates = ['date', 'value', 'timestamp']
    .filter((key) => Object.hasOwn(trigger, key))
    .map((key) => canonicalAbsoluteTrigger(trigger[key]));
  if (candidates.length === 0 || candidates.some((value) => value === null)) {
    return { kind: 'unknown' };
  }
  const first = candidates[0];
  if (
    first === null ||
    first === undefined ||
    candidates.some((candidate) => candidate !== first)
  ) {
    return { kind: 'unknown' };
  }
  return { kind: 'date', scheduledAt: first };
}

/**
 * Structural boundary around expo-notifications. Unit tests inject this
 * interface and do not initialize a platform notification module.
 */
export interface NativeNotificationsFacade {
  getPermissionState(): Promise<NativeNotificationPermissionResponse>;
  requestPermission(
    request: NativeNotificationPermissionRequest,
  ): Promise<NativeNotificationPermissionResponse>;
  ensureChannel(channel: NativeNotificationChannel): Promise<void>;
  schedule(input: NativeScheduleNotificationInput): Promise<string>;
  listScheduled(): Promise<readonly NativeNotificationRequest[]>;
  cancel(identifier: string): Promise<void>;
}
