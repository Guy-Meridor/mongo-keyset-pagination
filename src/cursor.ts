import { EJSON } from 'bson';
import { SortOrder, Cursor } from './types';
import { InvalidCursorError } from './errors';

/**
 * Safe dotted-path getter (replacement for `lodash.get`).
 * Returns `undefined` if any segment is missing or a non-object is traversed.
 */
export const getPath = (obj: unknown, path: string): unknown =>
  path.split('.').reduce<unknown>((acc, key) => {
    if (acc === null || typeof acc !== 'object') return undefined;
    return (acc as Record<string, unknown>)[key];
  }, obj);

/**
 * Build a cursor from a boundary document by reading each sort field's value.
 * Missing/undefined values are stored as `null` so the cursor always carries
 * every sort key (the match builder normalizes `null` when a field is nullable).
 */
export const buildCursorFromItem = (item: unknown, sort: SortOrder): Cursor => {
  const cursor: Cursor = {};
  for (const field of Object.keys(sort)) {
    cursor[field] = getPath(item, field) ?? null;
  }
  return cursor;
};

/**
 * Encode a cursor to an opaque, URL-safe-ish base64 string. Uses canonical
 * Extended JSON so BSON types (ObjectId, Date, Decimal128, MinKey, ...) survive
 * the round-trip exactly.
 */
export const encodeCursor = (cursor: Cursor): string => {
  const json = EJSON.stringify(cursor, { relaxed: false });
  return Buffer.from(json, 'utf8').toString('base64');
};

/** Decode a cursor produced by {@link encodeCursor}. Throws {@link InvalidCursorError} on bad input. */
export const decodeCursor = (encoded: string): Cursor => {
  let decoded: unknown;
  try {
    const json = Buffer.from(encoded, 'base64').toString('utf8');
    decoded = EJSON.parse(json, { relaxed: false });
  } catch (error) {
    throw new InvalidCursorError('Failed to decode pagination cursor', { cause: error });
  }
  // A valid cursor is a plain field→value map. Its values may be BSON instances
  // (ObjectId, Date, ...), but the top level itself must be a plain object —
  // reject a bare array or a bare BSON wrapper (e.g. EJSON of `5` is an Int32).
  const isPlainObject =
    typeof decoded === 'object' &&
    decoded !== null &&
    (Object.getPrototypeOf(decoded) === Object.prototype ||
      Object.getPrototypeOf(decoded) === null);
  if (!isPlainObject) {
    throw new InvalidCursorError('Decoded cursor is not a plain object');
  }
  return decoded as Cursor;
};
