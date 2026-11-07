# @adullamtech/norm

**Type-safe Notion API in 5 lines.**

The Notion API returns nested JSON blobs, requires manual property extraction, and gives you zero type safety. `norm` fixes all of that.

```ts
// ❌ Without norm
const response = await notion.pages.retrieve({ page_id: "abc" });
const title = (response.properties.Name as any).title[0].plain_text;
const price = (response.properties.Price as any).number ?? null;
// ...every field, every time

// ✅ With norm
const product = await Product.retrieve("abc");
console.log(product.title, product.price); // fully typed
```

---

## Install

```bash
pnpm add @adullamtech/norm @notionhq/client zod
```

---

## Setup

```ts
import { NormClient, n } from "@adullamtech/norm";
import { Client } from "@notionhq/client";

const norm = new NormClient({
  client: new Client({ auth: process.env.NOTION_API_KEY }),
  onWarn: (msg) => console.warn(msg),
  onError: (err) => console.error(err),
});
```

---

## Define a model

Map Notion columns to TypeScript fields. Once.

```ts
export const Product = norm.object({
  title: n.title(),
  price: n.number({ property: "Price" }),
  status: n.select({
    property: "Status",
    enum: ["active", "draft", "archived"],
  }),
  inStock: n.checkbox({ property: "In Stock" }),
  tags: n.multiSelect({ property: "Tags" }),
  sku: n.richText({ property: "SKU" }).optional(),
});

type Product = n.getType<typeof Product>;
// { id: string; title: string; price: number | null;
//   status: "active" | "draft" | "archived";
//   inStock: boolean; tags: string[]; sku?: string }
```

---

## Use it

### Read

```ts
// One page
const product = await Product.retrieve("page-id");

// Query with Notion filters — auto-parses results
const products = await Product.query("database-id", {
  filter: { property: "Status", select: { equals: "active" } },
  sorts: [{ property: "Price", direction: "ascending" }],
});

// Iterated query — handles pagination automatically
for await (const batch of Product.iteratedQuery("database-id", {
  filter: { property: "Status", select: { equals: "active" } },
  sorts: [{ property: "Price", direction: "ascending" }],
})) {
  // `batch` is an array of up-to-100 parsed pages 
  for (const product of batch) {
    console.log(product.title, product.price);
  }
}
```

### Create

Pass simple values. `norm` translates to Notion format.

```ts
await Product.create({
  parent: { data_source_id: "database-id" },
  properties: {
    title: "Ergonomic Keyboard",
    price: 149.99,
    status: "active",
    inStock: true,
    tags: ["electronics", "keyboards"],
  },
});
```

> Property names are your TypeScript field names — typos are compile errors.
> The underlying Notion property name (e.g. `"Price"` instead of `price`) is
> **not** accepted; passing one is dropped with an `onWarn` warning.

### Update

Pass only the fields you want to change. `norm` translates to Notion format.

```ts
await Product.update({
  pageId: "page-id",
  properties: {
    price: 129.99,
    status: "draft",
  },
});
```

Same translation rules as `create()` — simple values in, Notion format out. Unspecified properties are left untouched.

You can also update page markdown:

```ts
await Product.update({
  pageId: "page-id",
  properties: { title: "New Title" },
  markdown: "# Updated content",
});
```

Returns `true` on success, `false` on failure.

---

## More fields

```ts
import { n } from "@adullamtech/norm";

n.url({ property: "URL" });         // string | null
n.email({ property: "Email" });     // string
n.date({ property: "Due Date" });   // Date | null
n.singleRelation({ property: "Category" }); // string (first ID)
n.multiRelation({ property: "Tags" });      // string[]
n.rollupText({ property: "Author" });       // string
n.pageIcon();                               // string | null
n.markdown();                               // string | undefined
```

`n.relation()` is an alias for `n.singleRelation()`.

---

## Transform output

```ts
const Product = norm.object({
  title: n.title(),
  price: n.number({ property: "Price" }),
  currency: n.richText({ property: "Currency" }).default("USD"),
}, {
  transform: (data) => ({
    ...data,
    displayPrice: `${data.currency} $${data.price?.toFixed(2) ?? "0.00"}`,
    isFree: data.price === null || data.price === 0,
  }),
});
```

---

## Lazy client

For serverless or per-request auth, pass a factory instead of a client:

```ts
const norm = new NormClient({
  client: async () => new Client({ auth: await fetchAuthToken() }),
});
```

Called once, cached, concurrent requests deduplicated.

---

## Skip markdown fetch

Models with `n.markdown()` automatically fetch page content on every read. If you don't need it, pass `doNotIncludeMarkdown` to skip the extra API call:

```ts
const Article = norm.object({
  title: n.title(),
  body: n.markdown(),
});

// Fetches markdown (default)
const article = await Article.retrieve("page-id");

// Skips the markdown fetch — faster
const article = await Article.retrieve("page-id", {
  doNotIncludeMarkdown: true,
});
```

---

## Iterated query (auto-pagination)

`query()` returns a single page of results (up to 100). For large databases, use `iteratedQuery()` instead. It automatically fetches every page behind the scenes:

```ts
for await (const batch of Product.iteratedQuery("database-id", {
  filter: { property: "Status", select: { equals: "active" } },
  sorts: [{ property: "Price", direction: "ascending" }],
})) {
  // Each batch is an array of fully-parsed pages
  console.log(`got ${batch.length} products`);
  for (const product of batch) {
    processProduct(product);
  }
}
```

`iteratedQuery()` is an **async generator**. It yields one array per API call. The `for await` loop handles the cursor plumbing automatically; you just process each batch as it arrives.

It accepts the same options as `query()` (`filter`, `sorts`, `pageSize`).

---

## API

### Builders (`n.*`)

| Builder | Type | Writable |
|---|---|---|
| `n.title()` | `string` | ✅ |
| `n.richText()` | `string` | ✅ |
| `n.number()` | `number \| null` | ✅ |
| `n.checkbox()` | `boolean` | ✅ |
| `n.url()` | `string \| null` | ✅ |
| `n.email()` | `string` | ✅ |
| `n.date()` | `Date \| null` | ✅ |
| `n.select({ enum })` | enum union | ✅ |
| `n.select()` | `string \| null` | ✅ |
| `n.multiSelect()` | `string[]` | ✅ |
| `n.singleRelation()` | `string` | ✅ |
| `n.multiRelation()` | `string[]` | ✅ |
| `n.rollupText()` | `string` | ❌ read-only |
| `n.rollupRelation()` | `string[]` | ❌ read-only |
| `n.pageIcon()` | `string \| null` | ❌ read-only |
| `n.markdown()` | `string \| undefined` | ❌ read-only |

### `NormModel`

| Method | Returns |
|---|---|
| `model.retrieve(pageId)` | `T \| null` |
| `model.query(dbId, opts)` | `T[]` |
| `model.iteratedQuery(dbId, opts)` | `AsyncGenerator<T[]>` |
| `model.parse(data)` | `T` |
| `model.parsePage(page)` | `T` |
| `model.create(input)` | `string \| null` |
| `model.update(input)` | `boolean` |

### `NormClient` (low-level)

| Method | Purpose |
|---|---|
| `norm.queryDatabase()` | Raw Notion query |
| `norm.getPageById()` | Raw page fetch |
| `norm.createPage()` | Create a page |
| `norm.getPageMarkdown()` | Page as markdown |
| `norm.updatePage()` | Update page properties |
| `norm.updatePageMarkdown()` | Update page content |
| `norm.uploadFile()` | Upload to Notion |
| `norm.appendFileBlocks()` | Attach files to page |

---

## Auto `filter_properties`

`retrieve()` and `query()` automatically send only the properties declared in your schema. Slimmer responses, zero effort.

---

## License

MIT © [Adullam Technologies](https://adullamtech.com)

---

## Contributing

Contributions welcome. Open an [issue](https://github.com/Adullam-Technologies/norm/issues) or submit a PR.