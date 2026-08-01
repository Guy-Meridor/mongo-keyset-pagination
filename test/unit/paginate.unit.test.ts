import { describe, it, expect } from 'vitest';
import { paginate } from '../../src/paginate';
import { encodeCursor, buildCursorFromItem } from '../../src/cursor';
import { SortDirection, ScrollDirection } from '../../src/types';
import { InvalidCursorError, InvalidOptionsError } from '../../src/errors';

/** Minimal fake collection that records the pipeline (and aggregate options) and returns preset rows. */
const fakeCollection = (rows: unknown[]) => {
  const captured: { pipeline?: unknown[]; options?: unknown } = {};
  const collection = {
    aggregate(pipeline: unknown[], options?: unknown) {
      captured.pipeline = pipeline;
      captured.options = options;
      return { toArray: async () => rows };
    },
  };
  // Cast through unknown — we only exercise `aggregate`.
  return { captured, collection: collection as unknown as import('mongodb').Collection };
};

describe('paginate pipeline construction', () => {
  it('first page: no $match, sort as-is, fetches limit + 1', async () => {
    const { collection, captured } = fakeCollection([{ _id: 1 }, { _id: 2 }]);
    await paginate(collection, { sort: { _id: SortDirection.ASC }, limit: 2 });

    expect(captured.pipeline!.some((s) => (s as Record<string, unknown>).$match)).toBe(false);
    expect(captured.pipeline).toContainEqual({ $sort: { _id: SortDirection.ASC } });
    expect(captured.pipeline).toContainEqual({ $limit: 3 });
  });

  it('with cursor: prepends a $match stage', async () => {
    const cursor = encodeCursor(buildCursorFromItem({ _id: 1 }, { _id: SortDirection.ASC }));
    const { collection, captured } = fakeCollection([{ _id: 2 }]);
    await paginate(collection, { sort: { _id: SortDirection.ASC }, limit: 5, cursor });

    expect(captured.pipeline![0]).toHaveProperty('$match');
  });

  it('backward: reverses $sort and re-reverses returned documents', async () => {
    const cursor = encodeCursor(buildCursorFromItem({ _id: 5 }, { _id: SortDirection.ASC }));
    // DB returns rows in reversed (DESC) order because the query sort is reversed.
    const { collection, captured } = fakeCollection([{ _id: 4 }, { _id: 3 }]);
    const result = await paginate<{ _id: number }>(collection, {
      sort: { _id: SortDirection.ASC },
      limit: 5,
      cursor,
      direction: ScrollDirection.Top,
    });

    expect(captured.pipeline).toContainEqual({ $sort: { _id: SortDirection.DESC } });
    expect(result.documents.map((d) => d._id)).toEqual([3, 4]);
  });

  it('backward with an extra row: keeps the docs nearest the cursor, drops the farthest, reports hasPrevPage', async () => {
    const cursor = encodeCursor(buildCursorFromItem({ _id: 10 }, { _id: SortDirection.ASC }));
    // DB returns _id < 10 in reversed (DESC) order; limit + 1 = 3 rows fetched.
    const { collection, captured } = fakeCollection([{ _id: 9 }, { _id: 8 }, { _id: 7 }]);
    const result = await paginate<{ _id: number }>(collection, {
      sort: { _id: SortDirection.ASC },
      limit: 2,
      cursor,
      direction: ScrollDirection.Top,
    });

    expect(captured.pipeline).toContainEqual({ $sort: { _id: SortDirection.DESC } });
    expect(captured.pipeline).toContainEqual({ $limit: 3 });
    // Farthest-from-cursor (_id 7) is dropped; the two nearest are restored to caller order.
    expect(result.documents.map((d) => d._id)).toEqual([8, 9]);
    expect(result.pageInfo.hasPrevPage).toBe(true);
    expect(result.pageInfo.hasNextPage).toBe(true);
  });

  it('reports hasNextPage via the extra (limit + 1) document and trims it', async () => {
    const { collection } = fakeCollection([{ _id: 1 }, { _id: 2 }, { _id: 3 }]);
    const result = await paginate<{ _id: number }>(collection, {
      sort: { _id: SortDirection.ASC },
      limit: 2,
    });

    expect(result.documents.map((d) => d._id)).toEqual([1, 2]);
    expect(result.pageInfo.hasNextPage).toBe(true);
    expect(result.pageInfo.hasPrevPage).toBe(false);
    expect(result.pageInfo.nextCursor).toBeTypeOf('string');
    expect(result.pageInfo.prevCursor).toBeUndefined();
  });

  it('throws InvalidOptionsError for an empty sort or a bad limit', async () => {
    const { collection } = fakeCollection([]);
    await expect(
      paginate(collection, { sort: {}, limit: 5 }),
    ).rejects.toThrow(InvalidOptionsError);
    await expect(
      paginate(collection, { sort: { _id: SortDirection.ASC }, limit: 0 }),
    ).rejects.toThrow(InvalidOptionsError);
  });

  it('throws InvalidOptionsError when a nullableFields entry is not a sort field', async () => {
    const { collection } = fakeCollection([]);
    const promise = paginate(collection, {
      sort: { dueDate: SortDirection.ASC },
      limit: 5,
      nullableFields: ['due'],
    });
    await expect(promise).rejects.toThrow(InvalidOptionsError);
    await expect(promise).rejects.toThrow(/not a sort field/);
  });

  it('accepts nullableFields that are sort fields', async () => {
    const { collection } = fakeCollection([{ dueDate: 1 }]);
    await expect(
      paginate(collection, {
        sort: { dueDate: SortDirection.ASC, _id: SortDirection.ASC },
        limit: 5,
        nullableFields: ['dueDate'],
      }),
    ).resolves.toBeDefined();
  });

  it('places preStages before the keyset $match and postStages after $limit', async () => {
    const cursor = encodeCursor(
      buildCursorFromItem({ _id: 1 }, { _id: SortDirection.ASC }),
    );
    const pre = { $match: { status: 'active' } };
    const post = { $project: { _id: 1 } };
    const { collection, captured } = fakeCollection([{ _id: 2 }]);
    await paginate(collection, {
      sort: { _id: SortDirection.ASC },
      limit: 5,
      cursor,
      preStages: [pre],
      postStages: [post],
    });

    const p = captured.pipeline as Record<string, unknown>[];
    expect(p[0]).toEqual(pre);
    expect(p[1]).toHaveProperty('$match'); // the keyset match
    expect((p[1] as { $match: Record<string, unknown> }).$match).toHaveProperty('$or');
    expect(p[2]).toEqual({ $sort: { _id: SortDirection.ASC } });
    expect(p[3]).toEqual({ $limit: 6 });
    expect(p[4]).toEqual(post);
  });

  it('forwards aggregateOptions to collection.aggregate', async () => {
    const { collection, captured } = fakeCollection([{ _id: 1 }]);
    const aggregateOptions = { collation: { locale: 'en' }, maxTimeMS: 1000 };
    await paginate(collection, {
      sort: { _id: SortDirection.ASC },
      limit: 5,
      aggregateOptions,
    });
    expect(captured.options).toEqual(aggregateOptions);
  });

  it('backward + nullable: uses $expr with the flipped (LT) operator and reversed sort', async () => {
    const cursor = encodeCursor(
      buildCursorFromItem({ dueDate: null }, { dueDate: SortDirection.ASC }),
    );
    const { collection, captured } = fakeCollection([]);
    await paginate(collection, {
      sort: { dueDate: SortDirection.ASC },
      limit: 5,
      cursor,
      direction: ScrollDirection.Top,
      nullableFields: ['dueDate'],
    });

    const p = captured.pipeline as Record<string, unknown>[];
    const match = p[0] as {
      $match: { $or: Array<{ $and: Array<Record<string, any>> }> };
    };
    const cond = match.$match.$or[0]!.$and[0]!;
    expect(cond).toHaveProperty('$expr');
    // ASC sort + Top scroll => LT
    expect(cond.$expr.$lt[0]).toMatchObject({ $ifNull: ['$dueDate', expect.anything()] });
    expect(p).toContainEqual({ $sort: { dueDate: SortDirection.DESC } });
  });

  it('exactly limit rows: no extra, hasNextPage false, no nextCursor', async () => {
    const { collection } = fakeCollection([{ _id: 1 }, { _id: 2 }]);
    const result = await paginate<{ _id: number }>(collection, {
      sort: { _id: SortDirection.ASC },
      limit: 2,
    });
    expect(result.documents.map((d) => d._id)).toEqual([1, 2]);
    expect(result.pageInfo.hasNextPage).toBe(false);
    expect(result.pageInfo.nextCursor).toBeUndefined();
  });

  it('empty result with a cursor: no fabricated cursors, guard does not throw', async () => {
    const cursor = encodeCursor(
      buildCursorFromItem({ _id: 100 }, { _id: SortDirection.ASC }),
    );
    const { collection } = fakeCollection([]);
    const result = await paginate<{ _id: number }>(collection, {
      sort: { _id: SortDirection.ASC },
      limit: 5,
      cursor,
    });
    expect(result.documents).toEqual([]);
    expect(result.pageInfo.hasNextPage).toBe(false);
    expect(result.pageInfo.hasPrevPage).toBe(true); // came from a cursor
    expect(result.pageInfo.nextCursor).toBeUndefined();
    expect(result.pageInfo.prevCursor).toBeUndefined();
  });

  it('propagates InvalidCursorError for an undecodable cursor', async () => {
    const { collection } = fakeCollection([]);
    await expect(
      paginate(collection, {
        sort: { _id: SortDirection.ASC },
        limit: 5,
        cursor: '@@@',
      }),
    ).rejects.toThrow(InvalidCursorError);
  });

  it('throws InvalidOptionsError for a non-integer limit', async () => {
    const { collection } = fakeCollection([]);
    await expect(
      paginate(collection, { sort: { _id: SortDirection.ASC }, limit: 1.5 }),
    ).rejects.toThrow(InvalidOptionsError);
  });

  it('throws InvalidOptionsError for an invalid sort direction value', async () => {
    const { collection } = fakeCollection([]);
    await expect(
      // @ts-expect-error — a loosely-typed JS caller could pass a bad direction
      paginate(collection, { sort: { _id: 'asc' }, limit: 5 }),
    ).rejects.toThrow(InvalidOptionsError);
  });

  it('throws InvalidOptionsError when the cursor holds null for a non-nullable sort field', async () => {
    const cursor = encodeCursor(
      buildCursorFromItem({}, { dueDate: SortDirection.ASC }),
    );
    const { collection } = fakeCollection([]);
    await expect(
      paginate(collection, {
        sort: { dueDate: SortDirection.ASC },
        limit: 5,
        cursor,
      }),
    ).rejects.toThrow(InvalidOptionsError);
  });

  it('throws InvalidCursorError when the cursor does not match the current sort', async () => {
    const cursor = encodeCursor(
      buildCursorFromItem({ a: 1 }, { a: SortDirection.ASC }),
    );
    const { collection } = fakeCollection([]);
    await expect(
      paginate(collection, { sort: { b: SortDirection.ASC }, limit: 5, cursor }),
    ).rejects.toThrow(InvalidCursorError);
  });

  it('throws InvalidOptionsError for a reserved stage in preStages or postStages', async () => {
    const { collection } = fakeCollection([]);
    await expect(
      paginate(collection, {
        sort: { _id: SortDirection.ASC },
        limit: 5,
        preStages: [{ $sort: { _id: 1 } }],
      }),
    ).rejects.toThrow(InvalidOptionsError);
    await expect(
      paginate(collection, {
        sort: { _id: SortDirection.ASC },
        limit: 5,
        postStages: [{ $limit: 3 }],
      }),
    ).rejects.toThrow(InvalidOptionsError);
  });

  it('throws InvalidOptionsError if a returned document is missing a sort field', async () => {
    // postStages projected away the sort field, so the next cursor cannot be built.
    const { collection } = fakeCollection([{ other: 1 }, { other: 2 }]);
    await expect(
      paginate(collection, {
        sort: { seq: SortDirection.ASC },
        limit: 1,
        postStages: [{ $project: { other: 1 } }],
      }),
    ).rejects.toThrow(InvalidOptionsError);
  });
});
