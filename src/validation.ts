import type { PaginateOptions, SortOrder, Cursor } from "./types";
import { ScrollDirection, SortDirection } from "./types";
import { InvalidCursorError, InvalidOptionsError } from "./errors";
import { getPath } from "./cursor";

/**
 * Stage operators that `paginate` manages itself (`$sort`/`$limit`) or that
 * break keyset pagination outright (`$skip`, and the terminal `$out`/`$merge`).
 * Disallowed inside `preStages`/`postStages`.
 */
const RESERVED_STAGE_OPERATORS = new Set([
  "$sort",
  "$limit",
  "$skip",
  "$out",
  "$merge",
]);

const assertStagesAllowed = (stages: unknown, label: string): void => {
  if (stages === undefined) return;
  if (!Array.isArray(stages)) {
    throw new InvalidOptionsError(`paginate: \`${label}\` must be an array`);
  }
  for (const stage of stages) {
    for (const operator of Object.keys(stage ?? {})) {
      if (RESERVED_STAGE_OPERATORS.has(operator)) {
        throw new InvalidOptionsError(
          `paginate: ${label} must not contain ${operator} (paginate manages sort/limit; a terminal stage breaks pagination)`,
        );
      }
    }
  }
};

/**
 * Validate `paginate` options up front, throwing {@link InvalidOptionsError} on
 * any invalid input: an empty `sort`, a non-1/-1 sort direction, a `limit` that
 * isn't an integer >= 1, a bad `direction`, a `nullableFields` that isn't an
 * array or names a non-sort field, or a reserved stage in `preStages`/`postStages`.
 */
export const validateInput = (options: PaginateOptions): void => {
  const { sort, limit, direction, nullableFields, preStages, postStages } =
    options;

  if (!sort || Object.keys(sort).length === 0) {
    throw new InvalidOptionsError(
      "paginate: `sort` must contain at least one field",
    );
  }
  for (const [field, dir] of Object.entries(sort)) {
    if (dir !== SortDirection.ASC && dir !== SortDirection.DESC) {
      throw new InvalidOptionsError(
        `paginate: sort field "${field}" direction must be 1 (ASC) or -1 (DESC)`,
      );
    }
  }
  if (!Number.isInteger(limit) || limit < 1) {
    throw new InvalidOptionsError("paginate: `limit` must be an integer >= 1");
  }
  if (
    direction !== undefined &&
    direction !== ScrollDirection.Bottom &&
    direction !== ScrollDirection.Top
  ) {
    throw new InvalidOptionsError(
      "paginate: `direction` must be a ScrollDirection value",
    );
  }
  if (nullableFields !== undefined && !Array.isArray(nullableFields)) {
    throw new InvalidOptionsError("paginate: `nullableFields` must be an array");
  }
  const sortKeys = new Set(Object.keys(sort));
  for (const field of nullableFields ?? []) {
    if (!sortKeys.has(field)) {
      throw new InvalidOptionsError(
        `paginate: nullableFields entry "${field}" is not a sort field`,
      );
    }
  }
  assertStagesAllowed(preStages, "preStages");
  assertStagesAllowed(postStages, "postStages");
};

/**
 * Guard a decoded cursor against the current sort:
 *  - its keys must be exactly the sort fields, otherwise it was built with a
 *    different sort and would compare the wrong fields;
 *  - a `null` value for a field not declared nullable would make the keyset
 *    comparison (`{ field: { $gt: null } }`) match nothing and silently skip
 *    rows, so the field must be listed in `nullableFields`.
 */
export const validateCursorAgainstSort = (
  cursor: Cursor,
  sortKeys: Set<string>,
  nullable: Set<string>,
): void => {
  const cursorKeys = Object.keys(cursor);
  if (
    cursorKeys.length !== sortKeys.size ||
    !cursorKeys.every((key) => sortKeys.has(key))
  ) {
    throw new InvalidCursorError(
      "paginate: cursor does not match the current sort (it was likely created with a different sort)",
    );
  }
  for (const field of sortKeys) {
    if (cursor[field] === null && !nullable.has(field)) {
      throw new InvalidOptionsError(
        `paginate: sort field "${field}" is null in the cursor but not listed in nullableFields; add it to nullableFields`,
      );
    }
  }
};

/**
 * Assert a boundary document (used to build the next/prev cursor) still carries
 * every non-nullable sort field — catches `postStages` that projected one away.
 */
export const assertBoundarySortFields = (
  item: unknown,
  sort: SortOrder,
  nullable: Set<string>,
): void => {
  for (const field of Object.keys(sort)) {
    if (!nullable.has(field) && getPath(item, field) === undefined) {
      throw new InvalidOptionsError(
        `paginate: a returned document is missing sort field "${field}"; postStages must keep every sort field (or list it in nullableFields)`,
      );
    }
  }
};
