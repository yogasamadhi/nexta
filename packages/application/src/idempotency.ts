import { ApplicationError } from './errors';

export type JsonPrimitive = boolean | number | string | null;
export type JsonValue =
  JsonPrimitive | readonly JsonValue[] | { readonly [key: string]: JsonValue };

export type OperationIdentity = Readonly<{
  operationId: string;
  command: string;
  parameterHash: string;
}>;

export type StoredOperationResult<TResult> = OperationIdentity &
  Readonly<{
    result: TResult;
  }>;

const MAX_CANONICAL_DEPTH = 64;

function invalidParameters(message: string): never {
  throw new ApplicationError('validation_error', message, {
    retryable: false,
  });
}

function canonicalize(
  value: unknown,
  ancestors: WeakSet<object>,
  depth: number,
): string {
  if (depth > MAX_CANONICAL_DEPTH) {
    return invalidParameters('Operation parameters exceed the nesting limit.');
  }

  if (value === null) {
    return 'null';
  }

  switch (typeof value) {
    case 'boolean':
      return value ? 'true' : 'false';
    case 'number':
      if (!Number.isFinite(value)) {
        return invalidParameters(
          'Operation parameters must contain only finite numbers.',
        );
      }
      return Object.is(value, -0) ? '0' : JSON.stringify(value);
    case 'string':
      return JSON.stringify(value);
    case 'bigint':
    case 'function':
    case 'symbol':
    case 'undefined':
      return invalidParameters(
        'Operation parameters must contain only JSON values.',
      );
    case 'object': {
      if (ancestors.has(value)) {
        return invalidParameters('Operation parameters must not be cyclic.');
      }

      ancestors.add(value);
      try {
        if (Array.isArray(value)) {
          const ownKeys = Reflect.ownKeys(value);
          const expectedKeyCount = value.length + 1; // entries plus `length`
          if (
            ownKeys.length !== expectedKeyCount ||
            ownKeys.some(
              (key) =>
                typeof key !== 'string' ||
                (key !== 'length' &&
                  (!/^\d+$/.test(key) || Number(key) >= value.length)),
            )
          ) {
            return invalidParameters(
              'Operation parameter arrays must contain only indexed entries.',
            );
          }

          const entries: string[] = [];
          for (let index = 0; index < value.length; index += 1) {
            if (!Object.hasOwn(value, index)) {
              return invalidParameters(
                'Operation parameter arrays must not be sparse.',
              );
            }
            const descriptor = Object.getOwnPropertyDescriptor(value, index);
            if (descriptor === undefined || !('value' in descriptor)) {
              return invalidParameters(
                'Operation parameter arrays must not contain accessors.',
              );
            }
            entries.push(canonicalize(descriptor.value, ancestors, depth + 1));
          }
          return `[${entries.join(',')}]`;
        }

        const prototype = Object.getPrototypeOf(value);
        if (prototype !== Object.prototype && prototype !== null) {
          return invalidParameters(
            'Operation parameters must contain only plain JSON objects.',
          );
        }

        const ownKeys = Reflect.ownKeys(value);
        if (ownKeys.some((key) => typeof key !== 'string')) {
          return invalidParameters(
            'Operation parameter objects must not contain symbol keys.',
          );
        }

        const keys = Object.keys(value).sort();
        if (keys.length !== ownKeys.length) {
          return invalidParameters(
            'Operation parameter objects must contain only enumerable fields.',
          );
        }

        const entries = keys.map((key) => {
          const descriptor = Object.getOwnPropertyDescriptor(value, key);
          if (descriptor === undefined || !('value' in descriptor)) {
            return invalidParameters(
              'Operation parameter objects must not contain accessors.',
            );
          }
          return `${JSON.stringify(key)}:${canonicalize(
            descriptor.value,
            ancestors,
            depth + 1,
          )}`;
        });
        return `{${entries.join(',')}}`;
      } finally {
        ancestors.delete(value);
      }
    }
  }

  return invalidParameters(
    'Operation parameters contain an unsupported value.',
  );
}

/**
 * Produces a stable JSON representation for already-validated operation input.
 * Object key order is ignored; unsupported JSON lookalikes are rejected rather
 * than silently collapsed into the same idempotency identity.
 */
export function canonicalizeOperationParameters(input: unknown): string {
  return canonicalize(input, new WeakSet<object>(), 0);
}

function encodeUtf8(input: string): Uint8Array {
  const bytes: number[] = [];

  for (let index = 0; index < input.length; index += 1) {
    let codePoint = input.charCodeAt(index);

    if (codePoint >= 0xd800 && codePoint <= 0xdbff) {
      const next = input.charCodeAt(index + 1);
      if (next >= 0xdc00 && next <= 0xdfff) {
        codePoint = 0x10000 + ((codePoint - 0xd800) << 10) + (next - 0xdc00);
        index += 1;
      } else {
        codePoint = 0xfffd;
      }
    } else if (codePoint >= 0xdc00 && codePoint <= 0xdfff) {
      codePoint = 0xfffd;
    }

    if (codePoint <= 0x7f) {
      bytes.push(codePoint);
    } else if (codePoint <= 0x7ff) {
      bytes.push(0xc0 | (codePoint >>> 6));
      bytes.push(0x80 | (codePoint & 0x3f));
    } else if (codePoint <= 0xffff) {
      bytes.push(0xe0 | (codePoint >>> 12));
      bytes.push(0x80 | ((codePoint >>> 6) & 0x3f));
      bytes.push(0x80 | (codePoint & 0x3f));
    } else {
      bytes.push(0xf0 | (codePoint >>> 18));
      bytes.push(0x80 | ((codePoint >>> 12) & 0x3f));
      bytes.push(0x80 | ((codePoint >>> 6) & 0x3f));
      bytes.push(0x80 | (codePoint & 0x3f));
    }
  }

  return Uint8Array.from(bytes);
}

function rotateRight(value: number, amount: number): number {
  return (value >>> amount) | (value << (32 - amount));
}

const SHA_256_CONSTANTS = [
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1,
  0x923f82a4, 0xab1c5ed5, 0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3,
  0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174, 0xe49b69c1, 0xefbe4786,
  0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147,
  0x06ca6351, 0x14292967, 0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13,
  0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85, 0xa2bfe8a1, 0xa81a664b,
  0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a,
  0x5b9cca4f, 0x682e6ff3, 0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208,
  0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
] as const;

function sha256(input: string): string {
  const source = encodeUtf8(input);
  const paddedLength = Math.ceil((source.length + 9) / 64) * 64;
  const bytes = new Uint8Array(paddedLength);
  bytes.set(source);
  bytes[source.length] = 0x80;

  const bitLength = source.length * 8;
  const highLength = Math.floor(bitLength / 0x1_0000_0000);
  const lowLength = bitLength >>> 0;
  const view = new DataView(bytes.buffer);
  view.setUint32(paddedLength - 8, highLength, false);
  view.setUint32(paddedLength - 4, lowLength, false);

  let h0 = 0x6a09e667;
  let h1 = 0xbb67ae85;
  let h2 = 0x3c6ef372;
  let h3 = 0xa54ff53a;
  let h4 = 0x510e527f;
  let h5 = 0x9b05688c;
  let h6 = 0x1f83d9ab;
  let h7 = 0x5be0cd19;

  const words = new Uint32Array(64);
  for (let offset = 0; offset < bytes.length; offset += 64) {
    for (let index = 0; index < 16; index += 1) {
      words[index] = view.getUint32(offset + index * 4, false);
    }
    for (let index = 16; index < 64; index += 1) {
      const word15 = words[index - 15] ?? 0;
      const word2 = words[index - 2] ?? 0;
      const sigma0 =
        rotateRight(word15, 7) ^ rotateRight(word15, 18) ^ (word15 >>> 3);
      const sigma1 =
        rotateRight(word2, 17) ^ rotateRight(word2, 19) ^ (word2 >>> 10);
      words[index] =
        ((words[index - 16] ?? 0) +
          sigma0 +
          (words[index - 7] ?? 0) +
          sigma1) >>>
        0;
    }

    let a = h0;
    let b = h1;
    let c = h2;
    let d = h3;
    let e = h4;
    let f = h5;
    let g = h6;
    let h = h7;

    for (let index = 0; index < 64; index += 1) {
      const sum1 = rotateRight(e, 6) ^ rotateRight(e, 11) ^ rotateRight(e, 25);
      const choice = (e & f) ^ (~e & g);
      const temporary1 =
        (h +
          sum1 +
          choice +
          (SHA_256_CONSTANTS[index] ?? 0) +
          (words[index] ?? 0)) >>>
        0;
      const sum0 = rotateRight(a, 2) ^ rotateRight(a, 13) ^ rotateRight(a, 22);
      const majority = (a & b) ^ (a & c) ^ (b & c);
      const temporary2 = (sum0 + majority) >>> 0;

      h = g;
      g = f;
      f = e;
      e = (d + temporary1) >>> 0;
      d = c;
      c = b;
      b = a;
      a = (temporary1 + temporary2) >>> 0;
    }

    h0 = (h0 + a) >>> 0;
    h1 = (h1 + b) >>> 0;
    h2 = (h2 + c) >>> 0;
    h3 = (h3 + d) >>> 0;
    h4 = (h4 + e) >>> 0;
    h5 = (h5 + f) >>> 0;
    h6 = (h6 + g) >>> 0;
    h7 = (h7 + h) >>> 0;
  }

  return [h0, h1, h2, h3, h4, h5, h6, h7]
    .map((word) => word.toString(16).padStart(8, '0'))
    .join('');
}

/** Returns a non-reversible, stable digest suitable for OperationRecord. */
export function hashOperationParameters(input: unknown): string {
  return `sha256:${sha256(canonicalizeOperationParameters(input))}`;
}

/**
 * Returns a previously committed result for a safe replay, or `undefined` when
 * no operation exists. Reusing an ID for another command/input is always an
 * explicit conflict.
 */
export function replayStoredOperation<TResult>(
  stored: StoredOperationResult<TResult> | undefined,
  requested: OperationIdentity,
): TResult | undefined {
  if (stored === undefined) {
    return undefined;
  }

  assertOperationIdentity(stored, requested);
  return stored.result;
}

/** Validates the three-part identity before a persisted result is decoded. */
export function assertOperationIdentity(
  stored: OperationIdentity,
  requested: OperationIdentity,
): void {
  if (
    stored.operationId !== requested.operationId ||
    stored.command !== requested.command ||
    stored.parameterHash !== requested.parameterHash
  ) {
    throw new ApplicationError(
      'idempotency_conflict',
      'The operation ID was already used for another command or input.',
      {
        retryable: false,
        operationId: requested.operationId,
      },
    );
  }
}
