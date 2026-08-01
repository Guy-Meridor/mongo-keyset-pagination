import type { AggregateOptions } from 'mongodb';

/** Sort direction, matching MongoDB's `$sort` values. */
export enum SortDirection {
  ASC = 1,
  DESC = -1,
}

/** Scroll (navigation) direction relative to the current page. */
export enum ScrollDirection {
  /** Forward — the next page (default). */
  Bottom = 'bottom',
  /** Backward — the previous page. */
  Top = 'top',
}

/** Field-to-direction map describing the sort order, e.g. `{ createdAt: SortDirection.DESC, _id: SortDirection.ASC }`. */
export type SortOrder = Record<string, SortDirection>;

/** Decoded cursor: the sort-field values of a boundary document. */
export type Cursor = Record<string, unknown>;

/**
 * Minimal structural type for a MongoDB aggregation pipeline stage.
 * Avoids depending on `mongoose`/`mongodb` type exports while staying
 * assignable to the driver's `Document[]` pipeline parameter.
 */
export type PipelineStage = Record<string, unknown>;

/** Options for {@link paginate}. */
export interface PaginateOptions {
  /** Sort order. Must contain at least one field; include a unique field (e.g. `_id`) last as a tie-breaker. */
  sort: SortOrder;
  /** Maximum documents per page. Must be an integer >= 1. */
  limit: number;
  /** Opaque cursor from a previous page's `pageInfo`. Omit for the first page. */
  cursor?: string;
  /** Navigation direction. Defaults to {@link ScrollDirection.Bottom} (forward). */
  direction?: ScrollDirection;
  /**
   * Sort fields that may hold `null`/missing values. Only these fields use the
   * null-safe (index-bypassing) comparison; all other fields keep the fast,
   * index-friendly comparison. Every entry must be a field present in `sort` —
   * a non-sort entry throws at runtime.
   */
  nullableFields?: string[];
  /**
   * Aggregation stages inserted BEFORE the keyset `$match` — e.g. `$match`
   * filters, `$lookup`, or `$addFields` that computes a sort field. Every field
   * used in `sort` must exist by the time these stages finish.
   */
  preStages?: PipelineStage[];
  /**
   * Aggregation stages appended AFTER `$sort`/`$limit` — e.g. `$project` to
   * shape output, or a `$lookup` to enrich just the page. These stages must be
   * cardinality-preserving (they must not change the document count, or
   * `hasNextPage` and the next cursor break) and must keep every `sort` field
   * present (the next cursor is read back from the returned documents).
   */
  postStages?: PipelineStage[];
  /**
   * Options forwarded to `collection.aggregate` — e.g. `collation` (required
   * for correct pagination under a non-binary/locale collation), `maxTimeMS`,
   * `hint`, `allowDiskUse`, `session`.
   */
  aggregateOptions?: AggregateOptions;
}

/** Pagination metadata returned alongside the page of documents. */
export interface PageInfo {
  /** Cursor for the next (forward) page. Present when {@link hasNextPage} is true. */
  nextCursor?: string;
  /** Cursor for the previous (backward) page. Present when {@link hasPrevPage} is true. */
  prevCursor?: string;
  /** Whether a page exists after this one. */
  hasNextPage: boolean;
  /** Whether a page exists before this one. */
  hasPrevPage: boolean;
}

/** Result of {@link paginate}. */
export interface PaginateResult<T> {
  /** The page of documents, in the caller's requested sort order. */
  documents: T[];
  /** Cursors and page-boundary flags. */
  pageInfo: PageInfo;
}
