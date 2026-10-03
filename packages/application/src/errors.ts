export type ApplicationErrorCode =
  | 'validation_error'
  | 'not_found'
  | 'permission_required'
  | 'active_session_conflict'
  | 'invalid_transition'
  | 'preview_not_found'
  | 'preview_expired'
  | 'plan_conflict'
  | 'idempotency_conflict'
  | 'undo_unavailable'
  | 'reconciliation_required'
  | 'scheduling_setup_required'
  | 'adapter_error'
  | 'provider_error'
  | 'provider_timeout';

export type ApplicationErrorDetails = Readonly<{
  retryable: boolean;
  userAction?: string;
  causeCategory?: string;
  operationId?: string;
}>;

export type ApplicationErrorPayload = Readonly<{
  code: ApplicationErrorCode;
  message: string;
  retryable: boolean;
  userAction?: string;
  causeCategory?: string;
  operationId?: string;
}>;

/**
 * A platform-neutral error at an application boundary.
 *
 * The public payload deliberately omits `cause`, stack traces, SQL, provider
 * responses, and input values. Adapters may retain an internal cause for local
 * diagnostics, but must only expose `toPayload()` outside the application
 * boundary.
 */
export class ApplicationError extends Error {
  readonly code: ApplicationErrorCode;
  readonly retryable: boolean;
  readonly userAction: string | undefined;
  readonly causeCategory: string | undefined;
  readonly operationId: string | undefined;

  constructor(
    code: ApplicationErrorCode,
    message: string,
    details: ApplicationErrorDetails,
  ) {
    super(message);
    this.name = 'ApplicationError';
    this.code = code;
    this.retryable = details.retryable;
    this.userAction = details.userAction;
    this.causeCategory = details.causeCategory;
    this.operationId = details.operationId;
  }

  toPayload(): ApplicationErrorPayload {
    return {
      code: this.code,
      message: this.message,
      retryable: this.retryable,
      ...(this.userAction === undefined ? {} : { userAction: this.userAction }),
      ...(this.causeCategory === undefined
        ? {}
        : { causeCategory: this.causeCategory }),
      ...(this.operationId === undefined
        ? {}
        : { operationId: this.operationId }),
    };
  }
}

export function isApplicationError(error: unknown): error is ApplicationError {
  return error instanceof ApplicationError;
}
