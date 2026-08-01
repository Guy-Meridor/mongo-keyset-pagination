# mongo-keyset-pagination

Generic **keyset (cursor) pagination** for MongoDB aggregation pipelines.

> 📝 The story behind it: [How keyset pagination made our most-used API over 100x faster on MongoDB](https://medium.com/@guymeridor1/how-keyset-pagination-made-our-most-used-api-over-100x-faster-for-large-datasets-on-mongodb-bdfaa03052f6)

Offset pagination (`.skip(n).limit(k)`) makes the database walk and discard all
`n` skipped documents, so each page gets slower the deeper you go. Keyset
pagination instead seeks straight to your position via the index and reads only
the documents it returns. Per-page cost stays essentially constant, so the deeper
you paginate the greater the win: offset's work grows linearly with the page
number while keyset's stays flat.

It works by capturing the sort-field values of the page's last item (or first
item, when going backward) in the cursor, then building a set of comparison
conditions from those values that selects exactly the documents ordered after
(or before) it.

- Multi-field sort with automatic tie-breaker chaining
- Bidirectional: forward *and* backward navigation
- Opt-in null-safe comparisons per field
- Inject custom aggregation stages before/after the keyset condition

## Install

```bash
npm install mongo-keyset-pagination
# peer deps (usually already present):
npm install mongodb bson
```

## Quick start

```ts
import { paginate, SortDirection } from 'mongo-keyset-pagination';

const { documents, pageInfo } = await paginate(collection, {
  sort: { createdAt: SortDirection.DESC, _id: SortDirection.ASC },
  limit: 20,
  cursor, // omit for the first page; pass pageInfo.nextCursor for the next
});

// documents: your page, in sort order
// pageInfo: { nextCursor?, prevCursor?, hasNextPage, hasPrevPage }
```

> **⚠️ Your `sort` must define a total order.** End it with a field that is
> unique per document (usually `_id`) as a tie-breaker. If the leading fields can
> tie (e.g. two docs with the same `createdAt`) and there is no unique
> tie-breaker, keyset pagination will **silently skip or duplicate** rows at page
> boundaries. This is the one rule you must not get wrong.

### Backward navigation

```ts
import { ScrollDirection } from 'mongo-keyset-pagination';

const previous = await paginate(collection, {
  sort: { createdAt: SortDirection.DESC, _id: SortDirection.ASC },
  limit: 20,
  cursor: pageInfo.prevCursor,
  direction: ScrollDirection.Top,
});
```

### Nullable sort fields

If a sort field can be `null` or missing, list it in `nullableFields`. Those
`null`/missing values are treated as `MinKey`, which compares as smaller than
every other value, so those documents keep a stable position and are never
skipped:

```ts
await paginate(collection, {
  sort: { dueDate: SortDirection.ASC, _id: SortDirection.ASC },
  limit: 20,
  nullableFields: ['dueDate'],
});
```

Every entry must be a field in `sort`, and any sort field that can hold
`null`/missing values **must** be listed here. Otherwise those rows get skipped.
`paginate` throws if a cursor lands on an undeclared null rather than silently
losing data.

### Custom pipeline stages

Inject your own aggregation stages around the keyset condition with `preStages`
and `postStages`:

```ts
await paginate(collection, {
  sort: { createdAt: SortDirection.DESC, _id: SortDirection.ASC },
  limit: 20,
  cursor,
  // run BEFORE the keyset $match / $sort: filters, $lookup, computed sort fields
  preStages: [{ $match: { status: 'active' } }],
  // run AFTER $sort/$limit, on just the page: projection, page-level enrichment
  postStages: [{ $project: { title: 1, createdAt: 1 } }],
});
```

The pipeline paginate builds is:

```
[ ...preStages, <keyset $match>, { $sort }, { $limit: limit + 1 }, ...postStages ]
```

`preStages` run before the keyset match, so put any **computed sort fields**
there. `postStages` run on the returned page and must **preserve the row count**
and **keep every `sort` field** (the next cursor is read back off the results).
`$sort`, `$limit`, `$skip`, `$out`, and `$merge` are rejected in either list.

### Aggregate options

`aggregateOptions` is passed straight through to `collection.aggregate`, e.g.
`collation`, `maxTimeMS`, `hint`, `allowDiskUse`, or `session`:

```ts
await paginate(collection, {
  sort: { name: SortDirection.ASC, _id: SortDirection.ASC },
  limit: 20,
  aggregateOptions: { collation: { locale: 'en', strength: 2 }, maxTimeMS: 5000 },
});
```

> If your sort uses a non-binary collation (e.g. case-insensitive), pass the same
> `collation` here so paging agrees with the sort order. Nullable fields don't
> support non-binary collation.

## Indexing

Keyset pagination is only fast if the sort keys are backed by a **compound
index in the same order** as your `sort`. For the quick-start example:

```ts
await collection.createIndex({ createdAt: -1, _id: 1 });
```

Note: a field listed in `nullableFields` **can't use an index** for its
comparison, so only mark fields that truly contain nulls.

## API

- **`paginate(collection, options)`** is the main entry point. It returns
  `{ documents, pageInfo }`.
- Types/enums: `SortDirection`, `ScrollDirection`, `PaginateOptions`, `PageInfo`,
  `PaginateResult`, `SortOrder`, `Cursor`, `PipelineStage`.
- Errors: `InvalidOptionsError` (invalid options), `InvalidCursorError`
  (undecodable cursor).

**Advanced** building blocks for assembling your own pipeline:
`buildKeysetMatchStage`, `encodeCursor` / `decodeCursor`, `buildCursorFromItem`,
`resolveComparisonOperator`, `MongoComparisonOperator`.

## License

MIT © Guy Meridor
