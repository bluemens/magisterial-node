// Error hierarchy. Every non-2xx API response throws an APIStatusError
// subclass carrying the parsed {"error": {"type","code","message"}} envelope;
// transport failures throw APIConnectionError / APITimeoutError.

export class MagisterialError extends Error {
  override name = "MagisterialError";
}

export class APIConnectionError extends MagisterialError {
  override name = "APIConnectionError";
  constructor(message = "Connection error.", options?: { cause?: unknown }) {
    super(message, options);
  }
}

export class APITimeoutError extends APIConnectionError {
  override name = "APITimeoutError";
  constructor() {
    super("Request timed out.");
  }
}

export class QueryPollTimeout extends MagisterialError {
  override name = "QueryPollTimeout";
  runId: string;
  lastStatus: string;
  constructor(runId: string, lastStatus: string, timeoutMs: number) {
    super(
      `Query run ${runId} still '${lastStatus}' after ${Math.round(timeoutMs / 1000)}s; ` +
        `poll client.query.get('${runId}') to retrieve it later.`,
    );
    this.runId = runId;
    this.lastStatus = lastStatus;
  }
}

interface ErrorEnvelope {
  error?: { type?: string; code?: string; message?: string };
  detail?: unknown;
}

export class APIStatusError extends MagisterialError {
  override name = "APIStatusError";
  status: number;
  errorType?: string;
  errorCode?: string;
  body: unknown;
  /** Seconds from the Retry-After header, when present (429s). */
  retryAfter?: number;

  constructor(status: number, body: unknown, headers: Headers) {
    let message = `HTTP ${status}`;
    let errorType: string | undefined;
    let errorCode: string | undefined;
    if (body && typeof body === "object") {
      const envelope = body as ErrorEnvelope;
      if (envelope.error && typeof envelope.error === "object") {
        errorType = envelope.error.type;
        errorCode = envelope.error.code;
        message = envelope.error.message ?? message;
      } else if (envelope.detail !== undefined) {
        message = `Request validation failed: ${JSON.stringify(envelope.detail)}`;
      }
    }
    super(message);
    this.status = status;
    this.body = body;
    this.errorType = errorType;
    this.errorCode = errorCode;
    const retryAfter = headers.get("Retry-After");
    if (retryAfter !== null && !Number.isNaN(Number(retryAfter))) {
      this.retryAfter = Number(retryAfter);
    }
  }
}

export class BadRequestError extends APIStatusError {
  override name = "BadRequestError";
}
export class AuthenticationError extends APIStatusError {
  override name = "AuthenticationError";
}
export class BillingError extends APIStatusError {
  override name = "BillingError";
}
export class PermissionDeniedError extends APIStatusError {
  override name = "PermissionDeniedError";
}
export class NotFoundError extends APIStatusError {
  override name = "NotFoundError";
}
export class UnprocessableEntityError extends APIStatusError {
  override name = "UnprocessableEntityError";
}
export class RateLimitError extends APIStatusError {
  override name = "RateLimitError";
}
export class InternalServerError extends APIStatusError {
  override name = "InternalServerError";
}

const STATUS_TO_ERROR: Record<number, typeof APIStatusError> = {
  400: BadRequestError,
  401: AuthenticationError,
  402: BillingError,
  403: PermissionDeniedError,
  404: NotFoundError,
  422: UnprocessableEntityError,
  429: RateLimitError,
};

export function errorFromResponse(
  status: number,
  body: unknown,
  headers: Headers,
): APIStatusError {
  const cls =
    status >= 500 ? InternalServerError : (STATUS_TO_ERROR[status] ?? APIStatusError);
  return new cls(status, body, headers);
}
