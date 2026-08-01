import { MinKey } from "bson";
import { SortOrder, Cursor, PipelineStage, ScrollDirection } from "./types";
import {
  MongoComparisonOperator,
  resolveComparisonOperator,
} from "./operators";

/**
 * Sentinel that sorts before every BSON value. Used to give `null`/missing
 * fields a deterministic, comparable position when a field is declared nullable.
 */
const NULL_SENTINEL = new MinKey();

const normalizeNullable = (value: unknown): unknown =>
  value === null || value === undefined ? NULL_SENTINEL : value;

/** Fast, index-friendly comparison: `{ field: { $op: value } }`. */
const regularCondition = (
  field: string,
  operator: MongoComparisonOperator,
  value: unknown,
): Record<string, unknown> => ({ [field]: { [operator]: value } });

/**
 * Null-safe comparison via `$expr`/`$ifNull`, mapping both the stored field and
 * the cursor value through the sentinel so `null`/missing sort deterministically.
 * Bypasses indexes on this field — opt in per field via `nullableFields`.
 */
const nullSafeCondition = (
  field: string,
  operator: MongoComparisonOperator,
  value: unknown,
): Record<string, unknown> => ({
  $expr: {
    [operator]: [
      { $ifNull: [`$${field}`, NULL_SENTINEL] },
      normalizeNullable(value),
    ],
  },
});

/** Pick the null-safe or the regular comparison for a single field. */
const buildCondition = (
  field: string,
  operator: MongoComparisonOperator,
  value: unknown,
  isNullable: boolean,
): Record<string, unknown> =>
  isNullable
    ? nullSafeCondition(field, operator, value)
    : regularCondition(field, operator, value);

/**
 * Build the keyset `$match` stage for a cursor.
 *
 * For sort `[a, b, c]` (forward), produces:
 *   { $or: [
 *     { $and: [ a > va ] },
 *     { $and: [ a == va, b > vb ] },
 *     { $and: [ a == va, b == vb, c > vc ] },
 *   ] }
 * where each operator comes from {@link resolveComparisonOperator}.
 */
export const buildKeysetMatchStage = (
  cursor: Cursor,
  sort: SortOrder,
  scrollDirection: ScrollDirection = ScrollDirection.Bottom,
  nullableFields: string[] = [],
): PipelineStage => {
  const nullable = new Set(nullableFields);
  const sortFields = Object.entries(sort);
  const orConditions: Array<Record<string, unknown>> = [];

  for (let i = 0; i < sortFields.length; i++) {
    const andConditions: Array<Record<string, unknown>> = [];

    // Equality on every field before the current one.
    for (let j = 0; j < i; j++) {
      const [field] = sortFields[j]!;
      andConditions.push(
        buildCondition(
          field,
          MongoComparisonOperator.EQ,
          cursor[field],
          nullable.has(field),
        ),
      );
    }

    // Strict comparison on the current field.
    const [field, direction] = sortFields[i]!;
    const operator = resolveComparisonOperator(direction, scrollDirection);
    andConditions.push(
      buildCondition(field, operator, cursor[field], nullable.has(field)),
    );

    orConditions.push({ $and: andConditions });
  }

  return { $match: { $or: orConditions } };
};
