import { describe, it, expect } from 'vitest';
import { resolveComparisonOperator, MongoComparisonOperator } from '../../src/operators';
import { SortDirection, ScrollDirection } from '../../src/types';

describe('resolveComparisonOperator', () => {
  it('ASC + Bottom (forward) => GT', () => {
    expect(resolveComparisonOperator(SortDirection.ASC, ScrollDirection.Bottom))
      .toBe(MongoComparisonOperator.GT);
  });
  it('ASC + Top (backward) => LT', () => {
    expect(resolveComparisonOperator(SortDirection.ASC, ScrollDirection.Top))
      .toBe(MongoComparisonOperator.LT);
  });
  it('DESC + Bottom (forward) => LT', () => {
    expect(resolveComparisonOperator(SortDirection.DESC, ScrollDirection.Bottom))
      .toBe(MongoComparisonOperator.LT);
  });
  it('DESC + Top (backward) => GT', () => {
    expect(resolveComparisonOperator(SortDirection.DESC, ScrollDirection.Top))
      .toBe(MongoComparisonOperator.GT);
  });
});
