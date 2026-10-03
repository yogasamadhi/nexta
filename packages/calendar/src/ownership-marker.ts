export type OwnedEventMarker = Readonly<{
  version: 1;
  calendarOwnershipKey: string;
  timeBlockId: string;
  contentHash: string;
  nativeFingerprint: string;
  planRevision: number;
}>;

export type ParsedOwnedEventMarker =
  | Readonly<{ kind: 'none' }>
  | Readonly<{ kind: 'invalid' }>
  | Readonly<{
      kind: 'valid';
      marker: OwnedEventMarker;
      /** False when a user or another app added notes around our marker. */
      notesExact: boolean;
    }>;

function requireMarkerString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function prefix(namespace: string): string {
  if (namespace.trim().length === 0) {
    throw new Error('Calendar ownership marker namespace must not be empty.');
  }
  return `[[local-calendar-event:${encodeURIComponent(namespace)}:`;
}

export function createOwnedEventMarker(
  namespace: string,
  marker: Omit<OwnedEventMarker, 'version'>,
): string {
  if (
    !requireMarkerString(marker.calendarOwnershipKey) ||
    !requireMarkerString(marker.timeBlockId) ||
    !requireMarkerString(marker.contentHash) ||
    !requireMarkerString(marker.nativeFingerprint) ||
    !Number.isSafeInteger(marker.planRevision) ||
    marker.planRevision < 0
  ) {
    throw new Error('Calendar ownership marker fields are invalid.');
  }

  const payload: OwnedEventMarker = {
    version: 1,
    calendarOwnershipKey: marker.calendarOwnershipKey,
    timeBlockId: marker.timeBlockId,
    contentHash: marker.contentHash,
    nativeFingerprint: marker.nativeFingerprint,
    planRevision: marker.planRevision,
  };
  return `${prefix(namespace)}${encodeURIComponent(JSON.stringify(payload))}]]`;
}

export function parseOwnedEventMarker(
  namespace: string,
  notes: string | null | undefined,
): ParsedOwnedEventMarker {
  if (notes === null || notes === undefined) return { kind: 'none' };
  const markerPrefix = prefix(namespace);
  const start = notes.indexOf(markerPrefix);
  if (start < 0) return { kind: 'none' };
  const encodedStart = start + markerPrefix.length;
  const end = notes.indexOf(']]', encodedStart);
  if (end < 0 || notes.indexOf(markerPrefix, end + 2) >= 0) {
    return { kind: 'invalid' };
  }

  try {
    const value: unknown = JSON.parse(
      decodeURIComponent(notes.slice(encodedStart, end)),
    );
    if (typeof value !== 'object' || value === null || Array.isArray(value)) {
      return { kind: 'invalid' };
    }
    const candidate = value as Record<string, unknown>;
    if (
      Object.keys(candidate).length !== 6 ||
      candidate.version !== 1 ||
      !requireMarkerString(candidate.calendarOwnershipKey) ||
      !requireMarkerString(candidate.timeBlockId) ||
      !requireMarkerString(candidate.contentHash) ||
      !requireMarkerString(candidate.nativeFingerprint) ||
      !Number.isSafeInteger(candidate.planRevision) ||
      (candidate.planRevision as number) < 0
    ) {
      return { kind: 'invalid' };
    }
    return {
      kind: 'valid',
      notesExact: start === 0 && end + 2 === notes.length,
      marker: {
        version: 1,
        calendarOwnershipKey: candidate.calendarOwnershipKey,
        timeBlockId: candidate.timeBlockId,
        contentHash: candidate.contentHash,
        nativeFingerprint: candidate.nativeFingerprint,
        planRevision: candidate.planRevision as number,
      },
    };
  } catch {
    return { kind: 'invalid' };
  }
}
