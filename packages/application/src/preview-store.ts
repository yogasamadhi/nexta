import type { StoredSchedulePreview } from './schedule-types';

export interface SchedulePreviewStore {
  get(previewId: string): StoredSchedulePreview | null;
  put(preview: StoredSchedulePreview): void;
  delete(previewId: string): void;
  clear(): void;
}

function cloneValue<Value>(value: Value): Value {
  if (
    value === null ||
    typeof value === 'string' ||
    typeof value === 'number' ||
    typeof value === 'boolean' ||
    value === undefined
  ) {
    return value;
  }
  if (Array.isArray(value)) {
    return value.map((item) => cloneValue(item)) as Value;
  }
  if (typeof value === 'object') {
    const clone: Record<string, unknown> = {};
    for (const key of Object.keys(value)) {
      clone[key] = cloneValue((value as Record<string, unknown>)[key]);
    }
    return clone as Value;
  }
  throw new TypeError('Schedule previews must contain only data values.');
}

function deepFreeze<Value>(value: Value): Value {
  if (value !== null && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const key of Object.keys(value)) {
      deepFreeze((value as Record<string, unknown>)[key]);
    }
  }
  return value;
}

function isolated(preview: StoredSchedulePreview): StoredSchedulePreview {
  return deepFreeze(cloneValue(preview));
}

/** Process-local by design: application restart invalidates every preview. */
export class InMemorySchedulePreviewStore implements SchedulePreviewStore {
  readonly #previews = new Map<string, StoredSchedulePreview>();

  get(previewId: string): StoredSchedulePreview | null {
    const preview = this.#previews.get(previewId);
    return preview === undefined ? null : isolated(preview);
  }

  put(preview: StoredSchedulePreview): void {
    if (this.#previews.has(preview.preview.previewId)) {
      throw new Error('Duplicate schedule preview ID.');
    }
    this.#previews.set(preview.preview.previewId, isolated(preview));
  }

  delete(previewId: string): void {
    this.#previews.delete(previewId);
  }

  clear(): void {
    this.#previews.clear();
  }
}
