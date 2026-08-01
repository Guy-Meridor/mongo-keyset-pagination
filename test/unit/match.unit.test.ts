import { describe, it, expect } from 'vitest';
import { buildKeysetMatchStage } from '../../src/match';
import { SortDirection, ScrollDirection } from '../../src/types';

describe('buildKeysetMatchStage', () => {
  it('single ascending field, forward => one GT condition', () => {
    const stage = buildKeysetMatchStage(
      { createdAt: 10 },
      { createdAt: SortDirection.ASC },
      ScrollDirection.Bottom,
    );
    expect(stage).toEqual({
      $match: { $or: [{ $and: [{ createdAt: { $gt: 10 } }] }] },
    });
  });

  it('two fields, forward => tie-break chain with $eq on the prefix', () => {
    const stage = buildKeysetMatchStage(
      { createdAt: 10, _id: 'x' },
      { createdAt: SortDirection.ASC, _id: SortDirection.ASC },
      ScrollDirection.Bottom,
    );
    expect(stage).toEqual({
      $match: {
        $or: [
          { $and: [{ createdAt: { $gt: 10 } }] },
          { $and: [{ createdAt: { $eq: 10 } }, { _id: { $gt: 'x' } }] },
        ],
      },
    });
  });

  it('descending field, forward => LT', () => {
    const stage = buildKeysetMatchStage(
      { createdAt: 10 },
      { createdAt: SortDirection.DESC },
      ScrollDirection.Bottom,
    );
    expect(stage).toEqual({
      $match: { $or: [{ $and: [{ createdAt: { $lt: 10 } }] }] },
    });
  });

  it('nullable field uses $expr/$ifNull instead of a plain comparison', () => {
    const stage = buildKeysetMatchStage(
      { dueDate: null },
      { dueDate: SortDirection.ASC },
      ScrollDirection.Bottom,
      ['dueDate'],
    ) as { $match: { $or: Array<{ $and: Array<Record<string, unknown>> }> } };

    const condition = stage.$match.$or[0]!.$and[0] as {
      $expr?: { $gt?: unknown[] };
    };
    expect(condition.$expr).toBeDefined();
    expect(condition.$expr!.$gt![0]).toMatchObject({ $ifNull: ['$dueDate', expect.anything()] });
  });

  it('mixed ASC/DESC multi-field sort resolves per-field operators', () => {
    const stage = buildKeysetMatchStage(
      { priority: 5, createdAt: 10, _id: 'x' },
      {
        priority: SortDirection.DESC,
        createdAt: SortDirection.ASC,
        _id: SortDirection.ASC,
      },
      ScrollDirection.Bottom,
    );
    expect(stage).toEqual({
      $match: {
        $or: [
          { $and: [{ priority: { $lt: 5 } }] },
          { $and: [{ priority: { $eq: 5 } }, { createdAt: { $gt: 10 } }] },
          {
            $and: [
              { priority: { $eq: 5 } },
              { createdAt: { $eq: 10 } },
              { _id: { $gt: 'x' } },
            ],
          },
        ],
      },
    });
  });

  it('nullable field in a tie-break (prefix) position uses $expr for its $eq too', () => {
    const stage = buildKeysetMatchStage(
      { dueDate: null, _id: 'x' },
      { dueDate: SortDirection.ASC, _id: SortDirection.ASC },
      ScrollDirection.Bottom,
      ['dueDate'],
    ) as { $match: { $or: Array<{ $and: Array<Record<string, any>> }> } };

    // Second $or branch: dueDate equality prefix (j=0) then _id strict.
    const prefixCond = stage.$match.$or[1]!.$and[0]!;
    expect(prefixCond).toHaveProperty('$expr');
    expect(prefixCond.$expr.$eq[0]).toMatchObject({
      $ifNull: ['$dueDate', expect.anything()],
    });
  });
});
