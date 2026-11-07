import type {
  PageObjectResponse,
  QueryDataSourceParameters,
} from "@notionhq/client/build/src/api-endpoints";
import type { z, ZodRawShape, ZodType } from "zod";

export type { PageObjectResponse } from "@notionhq/client/build/src/api-endpoints";
export type { ExtractorType, NotionFieldMeta } from "./registry";

export interface NormConfig {
  /**
   * The @notionhq/client Client instance, or a factory that returns one.
   * A factory enables lazy-loading: the Client is created on the first
   * Notion API call rather than at construction time.
   */
  client:
    | import("@notionhq/client").Client
    | (() =>
        | import("@notionhq/client").Client
        | Promise<import("@notionhq/client").Client>);
  /** Called for recoverable warnings (e.g. missing extractor for a field). */
  onWarn?: (msg: string, ctx: Record<string, unknown>) => void;
  /** Called when a Notion API call throws. Host should log/capture. */
  onError?: (err: Error, ctx: Record<string, unknown>) => void;
}

export interface RetrieveOptions {
  doNotIncludeMarkdown?: boolean;
}

export interface QueryOpts extends RetrieveOptions {
  filter?: QueryDataSourceParameters["filter"];
  sorts?: QueryDataSourceParameters["sorts"];
  pageSize?: number;
  startCursor?: string;
}

export interface QueryDatabaseResult {
  results: PageObjectResponse[];
  pageSize: number;
  hasMore?: boolean;
  nextCursor?: string;
}

export interface CreatePageInput {
  parent: Record<string, unknown>;
  properties: Record<string, unknown>;
  markdown?: string;
}

export interface UpdatePageInput {
  pageId: string;
  properties: Record<string, unknown>;
  markdown?: string;
}

export interface GetPageByIdOptions {
  filterProperties?: string[];
}

export interface NormAttachment {
  fileUploadId: string;
  filename?: string;
  blockType: string;
}

/**
 * Simplified input value per extractor type for `Model.create`.
 * Users supply these; the library translates to Notion's verbose format.
 *
 * `singleRelation` is a type-level-only extractor name used by the
 * `n.singleRelation()` brand so writes accept a single id string.
 */
export type SimplifiedInput<E extends string> = E extends
  | "title"
  | "richText"
  | "email"
  ? string
  : E extends "number" | "url"
    ? string | number | null
    : E extends "checkbox"
      ? boolean
      : E extends "date"
        ? Date | string | null
        : E extends "select"
          ? string
          : E extends "multiSelect" | "relationIds"
            ? string[]
            : E extends "singleRelation"
              ? string
              : never;

/** Extractors that can be used when creating a page. */
export type CreatableExtractor =
  | "title"
  | "richText"
  | "number"
  | "select"
  | "checkbox"
  | "url"
  | "email"
  | "date"
  | "multiSelect"
  | "relationIds";

export const CREATABLE_EXTRACTORS: ReadonlySet<CreatableExtractor> = new Set([
  "title",
  "richText",
  "number",
  "select",
  "checkbox",
  "url",
  "email",
  "date",
  "multiSelect",
  "relationIds",
]);

/**
 * Extractors that accept a value on write. Mirrors `CREATABLE_EXTRACTORS`
 * plus the type-level-only `singleRelation` brand.
 */
type WritableExtractor = CreatableExtractor | "singleRelation";

/** Pull the extractor name out of a builder's `E::P` brand. */
type BrandExtractor<T> = [T] extends [never]
  ? never
  : T extends z.$brand<infer B>
    ? B extends `${infer E}::${string}`
      ? E
      : never
    : never;

/** Extractor declared by a schema field, or `never` for plain Zod fields. */
type ExtractorOf<S> = S extends ZodType ? BrandExtractor<z.input<S>> : never;

type IsWritableExtractor<E> = [E] extends [never]
  ? false
  : E extends WritableExtractor
    ? true
    : false;

/** TypeScript field names that can be passed to `create`/`update`. */
export type WritableKeys<TShape extends ZodRawShape> = {
  [K in keyof TShape]: IsWritableExtractor<ExtractorOf<TShape[K]>> extends true
    ? K
    : never;
}[keyof TShape];

type OptionalWritableKeys<TShape extends ZodRawShape> = {
  [K in WritableKeys<TShape>]: undefined extends z.input<TShape[K]>
    ? K
    : never;
}[WritableKeys<TShape>];

/**
 * The writable property shape for a model, keyed by TypeScript field names.
 * Read-only fields (`id`, markdown, rollups, page icon) are excluded, and
 * fields declared `.optional()`/`.default()` stay optional.
 */
export type WritableProps<TShape extends ZodRawShape> = {
  [K in Exclude<
    WritableKeys<TShape>,
    OptionalWritableKeys<TShape>
  >]: SimplifiedInput<ExtractorOf<TShape[K]>>;
} & {
  [K in OptionalWritableKeys<TShape>]?: SimplifiedInput<
    ExtractorOf<TShape[K]>
  >;
};
