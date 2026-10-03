import { DomainError } from './errors';
import {
  type Instant,
  type UserPreferenceId,
  parseInstant,
  parseUserPreferenceId,
  requireNonEmptyString,
} from './value-objects';

export type PreferenceJsonPrimitive = string | number | boolean | null;
export type PreferenceJsonValue =
  | PreferenceJsonPrimitive
  | readonly PreferenceJsonValue[]
  | Readonly<{ [key: string]: PreferenceJsonValue }>;

export type UserPreference = Readonly<{
  id: UserPreferenceId;
  key: string;
  valueJson: PreferenceJsonValue;
  updatedAt: Instant;
}>;

export type CreateUserPreferenceFields = Readonly<{
  id: UserPreferenceId;
  key: string;
  valueJson: PreferenceJsonValue;
  updatedAt: Instant;
}>;

function invalidJson(path: string, reason: string): never {
  throw new DomainError(
    'invalid_value',
    `UserPreference valueJson ${path} ${reason}.`,
    { field: 'valueJson', path },
  );
}

function normalizeJson(
  value: unknown,
  path: string,
  ancestors: ReadonlySet<object>,
): PreferenceJsonValue {
  if (
    value === null ||
    typeof value === 'string' ||
    typeof value === 'boolean'
  ) {
    return value;
  }
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) return invalidJson(path, 'must be finite');
    return value;
  }
  if (typeof value !== 'object') {
    return invalidJson(path, 'must contain only JSON values');
  }
  if (ancestors.has(value)) return invalidJson(path, 'must not be cyclic');

  const nextAncestors = new Set(ancestors);
  nextAncestors.add(value);
  if (Array.isArray(value)) {
    return Object.freeze(
      value.map((item, index) =>
        normalizeJson(item, `${path}[${index}]`, nextAncestors),
      ),
    );
  }
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) {
    return invalidJson(path, 'must use plain JSON objects');
  }

  const normalized: Record<string, PreferenceJsonValue> = {};
  for (const key of Reflect.ownKeys(value)) {
    if (typeof key !== 'string') {
      return invalidJson(path, 'must not contain symbol keys');
    }
    normalized[key] = normalizeJson(
      (value as Record<string, unknown>)[key],
      `${path}.${key}`,
      nextAncestors,
    );
  }
  return Object.freeze(normalized);
}

export function normalizePreferenceJson(value: unknown): PreferenceJsonValue {
  return normalizeJson(value, '$', new Set());
}

export function assertValidUserPreference(preference: UserPreference): void {
  parseUserPreferenceId(preference.id);
  requireNonEmptyString(preference.key, 'key');
  normalizePreferenceJson(preference.valueJson);
  parseInstant(preference.updatedAt);
}

export function createUserPreference(
  fields: CreateUserPreferenceFields,
): UserPreference {
  const preference: UserPreference = {
    id: parseUserPreferenceId(fields.id),
    key: requireNonEmptyString(fields.key, 'key'),
    valueJson: normalizePreferenceJson(fields.valueJson),
    updatedAt: parseInstant(fields.updatedAt),
  };
  assertValidUserPreference(preference);
  return preference;
}
