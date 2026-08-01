import type { Collection } from "mongodb";
import {
  PaginateOptions,
  PaginateResult,
  PageInfo,
  ScrollDirection,
  SortDirection,
  SortOrder,
  Cursor,
  PipelineStage,
} from "./types";
import { decodeCursor, encodeCursor, buildCursorFromItem } from "./cursor";
import { buildKeysetMatchStage } from "./match";
import {
  validateInput,
  validateCursorAgainstSort,
  assertBoundarySortFields,
} from "./validation";

/** Flip every field's sort direction. */
const reverseSort = (sort: SortOrder): SortOrder => {
  const reversed: SortOrder = {};
  for (const [field, direction] of Object.entries(sort)) {
    reversed[field] =
      direction === SortDirection.ASC ? SortDirection.DESC : SortDirection.ASC;
  }
  return reversed;
};

interface PageFlags {
  isBackward: boolean;
  hasExtra: boolean;
  hasInputCursor: boolean;
}

/** Derive cursors and boundary flags from the caller-ordered page. */
const buildPageInfo = (
  documents: unknown[],
  sort: SortOrder,
  nullable: Set<string>,
  flags: PageFlags,
): PageInfo => {
  const { isBackward, hasExtra, hasInputCursor } = flags;

  const hasNextPage = isBackward ? hasInputCursor : hasExtra;
  const hasPrevPage = isBackward ? hasExtra : hasInputCursor;

  const first = documents[0];
  const last = documents[documents.length - 1];

  let nextCursor: string | undefined;
  if (hasNextPage && last !== undefined) {
    assertBoundarySortFields(last, sort, nullable);
    nextCursor = encodeCursor(buildCursorFromItem(last, sort));
  }

  let prevCursor: string | undefined;
  if (hasPrevPage && first !== undefined) {
    assertBoundarySortFields(first, sort, nullable);
    prevCursor = encodeCursor(buildCursorFromItem(first, sort));
  }

  return { nextCursor, prevCursor, hasNextPage, hasPrevPage };
};

/**
 * Fetch one page of documents using keyset (cursor) pagination.
 *
 * Builds an aggregation pipeline: any `preStages`, an optional keyset `$match`
 * (present only when a cursor is supplied), a `$sort` (reversed internally when
 * scrolling backward), `$limit: limit + 1` (the extra document powers
 * `hasNextPage`/`hasPrevPage`), then any `postStages`. When scrolling backward
 * the returned documents are re-reversed so the page is always in the caller's
 * requested sort order.
 */
export const paginate = async <T = unknown>(
  collection: Collection,
  options: PaginateOptions,
): Promise<PaginateResult<T>> => {
  validateInput(options);

  const {
    sort,
    limit,
    cursor: encodedCursor,
    direction = ScrollDirection.Bottom,
    nullableFields = [],
    preStages = [],
    postStages = [],
    aggregateOptions,
  } = options;

  const sortKeys = new Set(Object.keys(sort));
  const nullable = new Set(nullableFields);

  const isBackward = direction === ScrollDirection.Top;
  const effectiveSort = isBackward ? reverseSort(sort) : sort;

  const pipeline: PipelineStage[] = [...preStages];
  if (encodedCursor) {
    const cursor: Cursor = decodeCursor(encodedCursor);
    validateCursorAgainstSort(cursor, sortKeys, nullable);
    pipeline.push(buildKeysetMatchStage(cursor, sort, direction, nullableFields));
  }
  pipeline.push({ $sort: effectiveSort });
  pipeline.push({ $limit: limit + 1 });
  pipeline.push(...postStages);

  // Note: mongodb's `aggregate<T>` constrains T to `Document`; our public API
  // keeps `<T = unknown>`, so call untyped and cast the result.
  const rows = (await collection
    .aggregate(pipeline, aggregateOptions)
    .toArray()) as T[];

  const hasExtra = rows.length > limit;
  const page = hasExtra ? rows.slice(0, limit) : rows;
  const documents = isBackward ? [...page].reverse() : page;

  const pageInfo = buildPageInfo(documents, sort, nullable, {
    isBackward,
    hasExtra,
    hasInputCursor: Boolean(encodedCursor),
  });

  return { documents, pageInfo };
};
