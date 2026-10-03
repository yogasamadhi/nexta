export type DomainErrorCode =
  'invalid_value' | 'invalid_transition' | 'invariant_violation';

export type DomainErrorDetails = Readonly<Record<string, unknown>>;

/**
 * A stable, platform-neutral domain failure.
 *
 * Messages describe the violated rule without echoing user-authored content.
 * Application boundaries may translate the code to their public error model.
 */
export class DomainError extends Error {
  readonly code: DomainErrorCode;
  readonly details: DomainErrorDetails | undefined;

  constructor(
    code: DomainErrorCode,
    message: string,
    details?: DomainErrorDetails,
  ) {
    super(message);
    this.name = 'DomainError';
    this.code = code;
    this.details = details;
  }
}

export function isDomainError(error: unknown): error is DomainError {
  return error instanceof DomainError;
}
