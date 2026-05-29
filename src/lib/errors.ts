export type ErrorCode =
  | 'invalid_request'
  | 'invalid_challenge'
  | 'challenge_already_used'
  | 'proof_mismatch'
  | 'proof_fetch_failed'
  | 'discovery_fetch_failed'
  | 'discovery_invalid'
  | 'discovery_did_mismatch'
  | 'unauthorized'
  | 'forbidden'
  | 'not_found'
  | 'conflict'
  | 'rate_limited'
  | 'internal_error';

export interface ErrorEnvelope {
  error: {
    code: ErrorCode;
    message: string;
    details?: Record<string, unknown>;
  };
}

export class RegistryError extends Error {
  readonly code: ErrorCode;
  readonly status: number;
  readonly details?: Record<string, unknown>;

  constructor(
    code: ErrorCode,
    message: string,
    status: number,
    details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = 'RegistryError';
    this.code = code;
    this.status = status;
    this.details = details;
  }

  toEnvelope(): ErrorEnvelope {
    return {
      error: {
        code: this.code,
        message: this.message,
        ...(this.details ? { details: this.details } : {}),
      },
    };
  }

  static invalidRequest(message: string, details?: Record<string, unknown>) {
    return new RegistryError('invalid_request', message, 400, details);
  }
  static unauthorized(message = 'Unauthorized') {
    return new RegistryError('unauthorized', message, 401);
  }
  static forbidden(message = 'Forbidden') {
    return new RegistryError('forbidden', message, 403);
  }
  static notFound(message = 'Not found') {
    return new RegistryError('not_found', message, 404);
  }
  static conflict(message: string, details?: Record<string, unknown>) {
    return new RegistryError('conflict', message, 409, details);
  }
  static rateLimited(message = 'Rate limit exceeded') {
    return new RegistryError('rate_limited', message, 429);
  }
  static internal(message = 'Internal error') {
    return new RegistryError('internal_error', message, 500);
  }
}
