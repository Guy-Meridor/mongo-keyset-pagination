import { SortDirection, ScrollDirection } from "./types";

/** MongoDB comparison operators used by the keyset match. */
export enum MongoComparisonOperator {
  EQ = "$eq",
  GT = "$gt",
  LT = "$lt",
}

/**
 * Resolve the comparison operator for a field given its sort direction and the
 * scroll direction.
 *
 * Truth table (GT unless noted):
 *   ASC  + forward(Bottom) => GT
 *   ASC  + backward(Top)   => LT
 *   DESC + forward(Bottom) => LT
 *   DESC + backward(Top)   => GT
 *
 * i.e. use `>` exactly when "ascending" and "scrolling backward" differ.
 */
export const resolveComparisonOperator = (
  sortDirection: SortDirection,
  scrollDirection: ScrollDirection,
): MongoComparisonOperator => {
  const isAscending = sortDirection === SortDirection.ASC;
  const isScrollingBackward = scrollDirection === ScrollDirection.Top;
  const useGreaterThan = isAscending !== isScrollingBackward;
  return useGreaterThan
    ? MongoComparisonOperator.GT
    : MongoComparisonOperator.LT;
};
