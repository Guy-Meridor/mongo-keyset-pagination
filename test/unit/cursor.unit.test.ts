import { describe, it, expect } from 'vitest';
import { ObjectId, Decimal128 } from 'bson';
import { encodeCursor, decodeCursor, buildCursorFromItem, getPath } from '../../src/cursor';
import { InvalidCursorError } from '../../src/errors';
import { SortDirection } from '../../src/types';

describe('cursor round-trip preserves BSON types', () => {
  it('keeps Date, ObjectId, Decimal128, and null', () => {
    const oid = new ObjectId();
    const original = {
      createdAt: new Date('2020-01-02T03:04:05.678Z'),
      _id: oid,
      score: Decimal128.fromString('12.34'),
      maybe: null,
    };
    const decoded = decodeCursor(encodeCursor(original));

    expect(decoded.createdAt).toBeInstanceOf(Date);
    expect((decoded.createdAt as Date).toISOString()).toBe('2020-01-02T03:04:05.678Z');
    expect(decoded._id).toBeInstanceOf(ObjectId);
    expect((decoded._id as ObjectId).equals(oid)).toBe(true);
    expect(decoded.score).toBeInstanceOf(Decimal128);
    expect((decoded.score as Decimal128).toString()).toBe('12.34');
    expect(decoded.maybe).toBeNull();
  });
});

describe('decodeCursor', () => {
  it('throws InvalidCursorError on malformed input', () => {
    expect(() => decodeCursor('!!!not-valid!!!')).toThrow(InvalidCursorError);
  });

  it('throws InvalidCursorError when the cursor decodes to a non-object', () => {
    const b64 = (s: string) => Buffer.from(s, 'utf8').toString('base64');
    expect(() => decodeCursor(b64('null'))).toThrow(InvalidCursorError);
    expect(() => decodeCursor(b64('[1,2]'))).toThrow(InvalidCursorError);
    expect(() => decodeCursor(b64('5'))).toThrow(InvalidCursorError);
  });
});

describe('getPath', () => {
  it('reads nested dotted paths', () => {
    expect(getPath({ a: { b: 1 } }, 'a.b')).toBe(1);
  });
  it('returns undefined for a missing path', () => {
    expect(getPath({ a: {} }, 'a.b.c')).toBeUndefined();
  });
  it('returns undefined when an intermediate value is null', () => {
    expect(getPath({ a: null }, 'a.b')).toBeUndefined();
    expect(getPath({ a: { b: null } }, 'a.b.c')).toBeUndefined();
  });
});

describe('buildCursorFromItem', () => {
  it('extracts sort fields and maps missing to null', () => {
    const cursor = buildCursorFromItem(
      { createdAt: 5, extra: 'ignored' },
      { createdAt: SortDirection.ASC, _id: SortDirection.ASC },
    );
    expect(cursor).toEqual({ createdAt: 5, _id: null });
  });
});
