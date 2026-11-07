import { z } from "zod";
import { notionRegistry, type ExtractorType } from "./registry";

/**
 * Type-level utility: the Notion brand carried by a builder's input type.
 * Builders brand the *input* side so schema outputs stay plain (`string`,
 * `number`, …) and Zod modifiers such as `.default()` keep working.
 *
 * @example
 *   const title = n.title();
 *   type T = z.input<typeof title>; // string & NotionBrand<"title", "title">
 */
export type NotionBrand<
  E extends string,
  P extends string = string,
> = z.$brand<`${E}::${P}`>;

function reg<T extends z.ZodType, P extends string>(
  schema: T,
  property: P,
  extractor: ExtractorType,
  extra: Record<string, unknown> = {},
): T {
  const meta = { notionProperty: property, extractor, ...extra };
  notionRegistry.add(schema, meta);
  return schema;
}

// ─── id ──────────────────────────────────────────────────────────────────────

export function id() {
  return reg(z.string(), "id", "id").brand<"id::id", "in">();
}

// ─── title ───────────────────────────────────────────────────────────────────

export function title<P extends string = "title">(opts?: { property?: P }) {
  const property = (opts?.property ?? "title") as P;
  return reg(z.string(), property, "title").brand<`title::${P}`, "in">();
}

// ─── richText ────────────────────────────────────────────────────────────────

export function richText<P extends string>(opts: { property: P }) {
  return reg(z.string(), opts.property, "richText").brand<
    `richText::${P}`,
    "in"
  >();
}

// ─── number ──────────────────────────────────────────────────────────────────

export function number<P extends string>(opts: { property: P }) {
  return reg(
    z.number().nullable(),
    opts.property,
    "number",
  ).brand<`number::${P}`, "in">();
}

// ─── checkbox ────────────────────────────────────────────────────────────────

export function checkbox<P extends string>(opts: { property: P }) {
  return reg(z.boolean(), opts.property, "checkbox").brand<
    `checkbox::${P}`,
    "in"
  >();
}

// ─── url ─────────────────────────────────────────────────────────────────────

export function url<P extends string>(opts: { property: P }) {
  return reg(z.string().nullable(), opts.property, "url").brand<
    `url::${P}`,
    "in"
  >();
}

// ─── email ───────────────────────────────────────────────────────────────────

export function email<P extends string>(opts: { property: P }) {
  return reg(z.string(), opts.property, "email").brand<
    `email::${P}`,
    "in"
  >();
}

// ─── date ─────────────────────────────────────────────────────────────────────

export function date<P extends string>(opts: { property: P }) {
  return reg(z.date().nullable(), opts.property, "date").brand<
    `date::${P}`,
    "in"
  >();
}

// ─── multiSelect ──────────────────────────────────────────────────────────────

export function multiSelect<P extends string>(opts: { property: P }) {
  return reg(
    z.array(z.string()),
    opts.property,
    "multiSelect",
  ).brand<`multiSelect::${P}`, "in">();
}

// ─── select ──────────────────────────────────────────────────────────────────

export function select<P extends string>(opts: {
  property: P;
  enum?: readonly [string, ...string[]];
  fallback?: string;
}) {
  const { property, enum: enumValues, fallback } = opts;

  if (enumValues && enumValues.length > 0) {
    const fb = fallback ?? enumValues[0];
    const base = z.enum(enumValues);
    const transformed = base
      .nullable()
      .transform((v: string | null) => v ?? fb);
    return reg(transformed, property, "select").brand<
      `select::${P}`,
      "in"
    >();
  }

  return reg(z.string().nullable(), property, "select").brand<
    `select::${P}`,
    "in"
  >();
}

// ─── singleRelation ──────────────────────────────────────────────────────────

export function singleRelation<P extends string>(opts: { property: P }) {
  const schema = reg(
    z.array(z.string()).transform((ids: string[]) => ids[0] ?? ""),
    opts.property,
    "relationIds",
  );
  // Branded as `singleRelation` so write inputs accept a single id string,
  // while the runtime extractor stays `relationIds`.
  return schema.brand<`singleRelation::${P}`, "in">();
}

// ─── multiRelation ───────────────────────────────────────────────────────────

export function multiRelation<P extends string>(opts: { property: P }) {
  const schema = reg(z.array(z.string()), opts.property, "relationIds");
  return schema.brand<`relationIds::${P}`, "in">();
}

/** Default alias — `relation` is `singleRelation`. */
export const relation = singleRelation;

// ─── rollupText ──────────────────────────────────────────────────────────────

export function rollupText<P extends string>(opts: { property: P }) {
  return reg(
    z.string(),
    opts.property,
    "rollupText",
  ).brand<`rollupText::${P}`, "in">();
}

// ─── rollupRelation ──────────────────────────────────────────────────────────

export function rollupRelation<P extends string>(opts: { property: P }) {
  return reg(
    z.array(z.string()),
    opts.property,
    "rollupRelationIds",
  ).brand<`rollupRelationIds::${P}`, "in">();
}

// ─── pageIcon ────────────────────────────────────────────────────────────────

export function pageIcon() {
  return reg(
    z.string().nullable(),
    "__icon__",
    "pageIcon",
  ).brand<"pageIcon::__icon__", "in">();
}

// ─── markdown ─────────────────────────────────────────────────────────────────

export function markdown() {
  return reg(
    z.string().optional(),
    "markdown",
    "markdown",
  ).brand<"markdown::markdown", "in">();
}

// ─── n namespace ─────────────────────────────────────────────────────────────

export const n = {
  id,
  title,
  richText,
  number,
  checkbox,
  url,
  email,
  date,
  multiSelect,
  select,
  singleRelation,
  multiRelation,
  relation,
  rollupText,
  rollupRelation,
  pageIcon,
  markdown,
};

/** Extract the output type of a NormModel. Usage: `type Foo = n.getType<typeof Model>`. */
export type getType<M> = M extends { readonly _normType: infer T } ? T : never;
