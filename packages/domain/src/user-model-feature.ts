import { DomainError } from './errors';
import {
  parseInstant,
  parseUserModelFeatureId,
  requireFiniteNumber,
  requireNonEmptyString,
  requireNonNegativeInteger,
  type Instant,
  type UserModelFeatureId,
} from './value-objects';

export type UserModelFeature = Readonly<{
  id: UserModelFeatureId;
  featureKey: string;
  scopeKey: string | null;
  numericValue: number;
  windowStart: Instant;
  windowEnd: Instant;
  sourceStateVersion: number;
  sampleCount: number;
  confidence: number;
  algorithmVersion: string;
  lastUpdatedAt: Instant;
}>;

export type CreateUserModelFeatureFields = Readonly<{
  id: UserModelFeatureId;
  featureKey: string;
  scopeKey?: string | null;
  numericValue: number;
  windowStart: Instant;
  windowEnd: Instant;
  sourceStateVersion: number;
  sampleCount: number;
  confidence: number;
  algorithmVersion: string;
  lastUpdatedAt: Instant;
}>;

function optionalScope(value: string | null | undefined): string | null {
  return value === null || value === undefined
    ? null
    : requireNonEmptyString(value, 'scopeKey');
}

export function userModelFeatureIdentity(
  feature: Pick<
    UserModelFeature,
    'algorithmVersion' | 'featureKey' | 'scopeKey'
  >,
): string {
  return JSON.stringify([
    requireNonEmptyString(feature.algorithmVersion, 'algorithmVersion'),
    requireNonEmptyString(feature.featureKey, 'featureKey'),
    optionalScope(feature.scopeKey),
  ]);
}

export function assertValidUserModelFeature(feature: UserModelFeature): void {
  parseUserModelFeatureId(feature.id);
  userModelFeatureIdentity(feature);
  const value = requireFiniteNumber(feature.numericValue, 'numericValue');
  if (Math.abs(value) > Number.MAX_SAFE_INTEGER) {
    throw new DomainError(
      'invalid_value',
      'numericValue must remain within the safe finite range.',
      { field: 'numericValue' },
    );
  }
  const windowStart = parseInstant(feature.windowStart);
  const windowEnd = parseInstant(feature.windowEnd);
  if (Date.parse(windowStart) >= Date.parse(windowEnd)) {
    throw new DomainError(
      'invalid_value',
      'UserModelFeature window must be a non-empty half-open range.',
      { field: 'windowEnd' },
    );
  }
  requireNonNegativeInteger(feature.sourceStateVersion, 'sourceStateVersion');
  requireNonNegativeInteger(feature.sampleCount, 'sampleCount');
  const confidence = requireFiniteNumber(feature.confidence, 'confidence');
  if (confidence < 0 || confidence > 1) {
    throw new DomainError(
      'invalid_value',
      'confidence must be between zero and one.',
      { field: 'confidence' },
    );
  }
  parseInstant(feature.lastUpdatedAt);
}

export function createUserModelFeature(
  input: CreateUserModelFeatureFields,
): UserModelFeature {
  const feature: UserModelFeature = {
    id: parseUserModelFeatureId(input.id),
    featureKey: requireNonEmptyString(input.featureKey, 'featureKey'),
    scopeKey: optionalScope(input.scopeKey),
    numericValue: requireFiniteNumber(input.numericValue, 'numericValue'),
    windowStart: parseInstant(input.windowStart),
    windowEnd: parseInstant(input.windowEnd),
    sourceStateVersion: requireNonNegativeInteger(
      input.sourceStateVersion,
      'sourceStateVersion',
    ),
    sampleCount: requireNonNegativeInteger(input.sampleCount, 'sampleCount'),
    confidence: requireFiniteNumber(input.confidence, 'confidence'),
    algorithmVersion: requireNonEmptyString(
      input.algorithmVersion,
      'algorithmVersion',
    ),
    lastUpdatedAt: parseInstant(input.lastUpdatedAt),
  };
  assertValidUserModelFeature(feature);
  return feature;
}
