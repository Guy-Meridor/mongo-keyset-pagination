/**
 * Thrown when the options passed to `paginate` fail validation — an empty
 * `sort`, a `limit` that isn't an integer >= 1, or a `nullableFields` entry
 * that isn't one of the `sort` fields.
 */
export class InvalidOptionsError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InvalidOptionsError';
  }
}

/** Thrown when a cursor string cannot be decoded (bad base64 or malformed EJSON). */
export class InvalidCursorError extends Error {
  cause?: unknown;

  constructor(message: string, options?: { cause?: unknown }) {
    super(message);
    this.name = 'InvalidCursorError';
    if (options?.cause !== undefined) {
      this.cause = options.cause;
    }
  }
}
