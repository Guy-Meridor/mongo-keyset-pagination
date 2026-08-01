import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { MongoDBContainer, StartedMongoDBContainer } from '@testcontainers/mongodb';
import { MongoClient, Collection } from 'mongodb';
import { paginate } from '../../src';
import { SortDirection, ScrollDirection, PageInfo } from '../../src/types';

describe('paginate integration (real MongoDB)', () => {
  let container: StartedMongoDBContainer;
  let client: MongoClient;
  let items: Collection;

  beforeAll(async () => {
    container = await new MongoDBContainer('mongo:7').start();
    client = new MongoClient(container.getConnectionString(), { directConnection: true });
    await client.connect();
    items = client.db('test').collection('items');
    // 25 docs across 3 groups; (group, seq) is a strict total order.
    await items.insertMany(
      Array.from({ length: 25 }, (_, i) => ({ seq: i, group: i % 3 })),
    );
  });

  afterAll(async () => {
    await client?.close();
    await container?.stop();
  });

  it('walks forward through every document exactly once', async () => {
    const sort = { group: SortDirection.ASC, seq: SortDirection.ASC };
    const seen: number[] = [];
    let cursor: string | undefined;

    for (let guard = 0; guard < 100; guard++) {
      const { documents, pageInfo } = await paginate<{ seq: number }>(items, {
        sort,
        limit: 7,
        cursor,
      });
      seen.push(...documents.map((d) => d.seq));
      if (!pageInfo.hasNextPage) break;
      cursor = pageInfo.nextCursor;
    }

    expect(seen.length).toBe(25);
    expect(new Set(seen).size).toBe(25);
    expect([...seen].sort((a, b) => a - b)).toEqual([...Array(25).keys()]);
  });

  it('navigates backward to the correct previous page, in order', async () => {
    const sort = { seq: SortDirection.ASC };

    const first = await paginate<{ seq: number }>(items, { sort, limit: 5 });
    expect(first.documents.map((d) => d.seq)).toEqual([0, 1, 2, 3, 4]);
    expect(first.pageInfo.hasPrevPage).toBe(false);

    const second = await paginate<{ seq: number }>(items, {
      sort,
      limit: 5,
      cursor: first.pageInfo.nextCursor,
    });
    expect(second.documents.map((d) => d.seq)).toEqual([5, 6, 7, 8, 9]);

    const back = await paginate<{ seq: number }>(items, {
      sort,
      limit: 5,
      cursor: second.pageInfo.prevCursor,
      direction: ScrollDirection.Top,
    });
    expect(back.documents.map((d) => d.seq)).toEqual([0, 1, 2, 3, 4]);
    expect(back.pageInfo.hasPrevPage).toBe(false);
    expect(back.pageInfo.hasNextPage).toBe(true);
  });

  it('paginates a nullable Date sort field without losing documents', async () => {
    const nc = client.db('test').collection('nullable');
    await nc.insertMany([
      { seq: 1, due: null },
      { seq: 2 }, // field missing
      { seq: 3, due: new Date('2020-01-01T00:00:00Z') },
      { seq: 4, due: new Date('2020-02-01T00:00:00Z') },
    ]);

    const sort = { due: SortDirection.ASC, seq: SortDirection.ASC };
    const seen: number[] = [];
    let cursor: string | undefined;

    for (let guard = 0; guard < 100; guard++) {
      const { documents, pageInfo } = await paginate<{ seq: number }>(nc, {
        sort,
        limit: 2,
        cursor,
        nullableFields: ['due'],
      });
      seen.push(...documents.map((d) => d.seq));
      if (!pageInfo.hasNextPage) break;
      cursor = pageInfo.nextCursor;
    }

    expect(seen.length).toBe(4);
    expect(new Set(seen).size).toBe(4);
    expect([...seen].sort((a, b) => a - b)).toEqual([1, 2, 3, 4]);
  });

  it('applies preStages (filter) and postStages (projection)', async () => {
    const col = client.db('test').collection('prepost');
    await col.insertMany([
      { seq: 1, status: 'active', secret: 'a' },
      { seq: 2, status: 'inactive', secret: 'b' },
      { seq: 3, status: 'active', secret: 'c' },
      { seq: 4, status: 'active', secret: 'd' },
    ]);

    const { documents } = await paginate<{ seq: number; secret?: string }>(col, {
      sort: { seq: SortDirection.ASC },
      limit: 10,
      preStages: [{ $match: { status: 'active' } }],
      postStages: [{ $project: { seq: 1, _id: 0 } }],
    });

    expect(documents.map((d) => d.seq)).toEqual([1, 3, 4]);
    expect(documents.every((d) => d.secret === undefined)).toBe(true);
  });

  it('scrolls backward from a middle page, trimming the extra row', async () => {
    const sort = { seq: SortDirection.ASC };
    const p1 = await paginate<{ seq: number }>(items, { sort, limit: 7 });
    const p2 = await paginate<{ seq: number }>(items, {
      sort,
      limit: 7,
      cursor: p1.pageInfo.nextCursor,
    });
    const p3 = await paginate<{ seq: number }>(items, {
      sort,
      limit: 7,
      cursor: p2.pageInfo.nextCursor,
    });
    expect(p3.documents.map((d) => d.seq)).toEqual([14, 15, 16, 17, 18, 19, 20]);

    const back = await paginate<{ seq: number }>(items, {
      sort,
      limit: 7,
      cursor: p3.pageInfo.prevCursor,
      direction: ScrollDirection.Top,
    });
    expect(back.documents.map((d) => d.seq)).toEqual([7, 8, 9, 10, 11, 12, 13]);
    expect(back.pageInfo.hasPrevPage).toBe(true); // seq 0-6 still before
    expect(back.pageInfo.hasNextPage).toBe(true);
  });

  it('reports the final page correctly (partial, no next)', async () => {
    const sort = { seq: SortDirection.ASC };
    let documents: { seq: number }[] = [];
    let pageInfo!: PageInfo;
    let cursor: string | undefined;

    for (let guard = 0; guard < 100; guard++) {
      ({ documents, pageInfo } = await paginate<{ seq: number }>(items, {
        sort,
        limit: 7,
        cursor,
      }));
      if (!pageInfo.hasNextPage) break;
      cursor = pageInfo.nextCursor;
    }

    // 25 docs at 7 per page => final page holds seq 21-24.
    expect(documents.map((d) => d.seq)).toEqual([21, 22, 23, 24]);
    expect(pageInfo.hasNextPage).toBe(false);
    expect(pageInfo.nextCursor).toBeUndefined();
  });
});
