import type { z, ZodType, ZodRawShape } from "zod";
import { ZodObject } from "zod";
import type { NormClient } from "./client";
import type { RetrieveOptions, QueryOpts } from "./types";
import { CREATABLE_EXTRACTORS } from "./types";
import type { CreatableExtractor } from "./types";
import { getNotionMeta } from "./retriever";
import type { ExtractorType } from "./registry";
import { id as makeIdBuilder } from "./builders";

export interface NormModel<T, CreateProps> {
  /** Marker for `n.getType` — holds the output type at the type level. */
  readonly _normType: T;
  /** The underlying Zod schema. Rarely needed directly; prefer `.parse()`/`.retrieve()`. */
  readonly schema: ZodType<T>;
  /** Notion property names declared in the schema (excludes id/markdown/icon). */
  readonly propertyNames: readonly string[];
  parse(data: unknown): T;
  retrieve(pageId: string, opts?: RetrieveOptions): Promise<T | null>;
  parsePage(page: PageObjectResponse, opts?: RetrieveOptions): Promise<T>;
  create(input: {
    parent: Record<string, unknown>;
    properties: CreateProps;
    markdown?: string;
  }): Promise<string | null>;
  update(input: {
    pageId: string;
    properties: Partial<CreateProps>;
    markdown?: string;
  }): Promise<boolean>;
  query(databaseId: string, opts?: QueryOpts): Promise<T[]>;
  iteratedQuery(
    databaseId: string,
    opts?: QueryOpts,
  ): AsyncGenerator<T[], number, void>;
}

import type { PageObjectResponse } from "@notionhq/client/build/src/api-endpoints";

// ─── translate simplified input → Notion verbose property format ─────────────

function translateProperty(extractor: string, value: unknown): unknown {
  switch (extractor) {
    case "title":
      return { title: [{ text: { content: String(value) } }] };
    case "richText":
      return { rich_text: [{ text: { content: String(value) } }] };
    case "number":
      return { number: value === null ? null : Number(value) };
    case "checkbox":
      return { checkbox: Boolean(value) };
    case "url":
      return { url: value === null ? null : String(value) };
    case "email":
      return { email: String(value) };
    case "date": {
      if (value === null) return { date: null };
      const dateStr =
        value instanceof Date ? value.toISOString() : String(value);
      return { date: { start: dateStr } };
    }
    case "select":
      return { select: value === null ? null : { name: String(value) } };
    case "multiSelect": {
      const names = Array.isArray(value) ? value : [];
      return { multi_select: names.map((name) => ({ name: String(name) })) };
    }
    case "relationIds": {
      const ids =
        value === null || value === undefined
          ? []
          : Array.isArray(value)
            ? value
            : [value];
      return { relation: ids.map((id) => ({ id: String(id) })) };
    }
    default:
      return undefined;
  }
}

// ─── norm.object implementation ──────────────────────────────────────────────

export function defineObject<TShape extends ZodRawShape>(
  client: NormClient,
  shape: TShape,
  opts?: {
    transform?: (data: z.infer<ZodObject<TShape>>) => unknown;
  },
): NormModel<unknown, unknown> {
  // Auto-inject id: n.id() if not present
  const finalShape: ZodRawShape =
    "id" in shape ? shape : { id: makeIdField(), ...shape };

  const baseSchema = new ZodObject({
    shape: finalShape,
  } as never) as unknown as ZodObject<TShape>;
  const schema = opts?.transform
    ? (baseSchema.transform(opts.transform as never) as ZodType)
    : (baseSchema as ZodType);

  // Collect property names for filter_properties
  const propertyNames = collectPropertyNames(finalShape);

  const self: NormModel<unknown, unknown> = {
    _normType: undefined as unknown,
    schema: schema as ZodType<unknown>,
    propertyNames,
    parse(data: unknown) {
      return (schema as ZodType<unknown>).parse(data);
    },
    async retrieve(pageId, retrieveOpts) {
      return client.retrievePage(
        pageId,
        schema as ZodType<unknown>,
        retrieveOpts as RetrieveOptions,
        propertyNames,
      );
    },
    async parsePage(page, parseOpts) {
      return client.retrieveFromPage(
        page,
        schema as ZodType<unknown>,
        parseOpts as RetrieveOptions,
      );
    },
    async create(input) {
      const translated = translateProperties(
        finalShape,
        input.properties as Record<string, unknown>,
        client,
      );
      return client.createPage({
        parent: input.parent,
        properties: translated,
        markdown: input.markdown,
      });
    },
    async update(input) {
      const translated = translateProperties(
        finalShape,
        input.properties as Record<string, unknown>,
        client,
      );

      // Nothing to write — avoid a pointless (and possibly failing) API call.
      if (Object.keys(translated).length === 0 && input.markdown === undefined) {
        return false;
      }

      return client.updatePage({
        pageId: input.pageId,
        properties: translated,
        markdown: input.markdown,
      });
    },
    async query(databaseId, queryOpts) {
      const { results } = await client.queryDatabase(databaseId, {
        filter: queryOpts?.filter,
        sorts: queryOpts?.sorts,
        filterProperties: [...propertyNames],
        pageSize: queryOpts?.pageSize,
        startCursor: queryOpts?.startCursor,
      });
      return Promise.all(
        results.map((page) =>
          client.retrieveFromPage(
            page,
            schema as ZodType<unknown>,
            queryOpts as RetrieveOptions,
          ),
        ),
      );
    },
    async *iteratedQuery(databaseId, queryOpts) {
      let nextCursor: string | undefined;
      let pageCount = 0;

      do {
        const response = await client.queryDatabase(databaseId, {
          filter: queryOpts?.filter,
          sorts: queryOpts?.sorts,
          filterProperties: [...propertyNames],
          startCursor: nextCursor,
        });

        nextCursor = response.nextCursor;
        pageCount += response.pageSize;

        yield Promise.all(
          response.results.map((page) =>
            client.retrieveFromPage(
              page,
              schema as ZodType<unknown>,
              queryOpts as RetrieveOptions,
            ),
          ),
        );

        if (response.pageSize <= 0) break;
      } while (nextCursor);

      return pageCount;
    },
  };

  return self;
}

// ─── helpers ────────────────────────────────────────────────────────────────

function makeIdField(): ZodType {
  return makeIdBuilder() as ZodType;
}

function collectPropertyNames(shape: ZodRawShape): string[] {
  const names: string[] = [];
  for (const [key, fieldSchema] of Object.entries(shape)) {
    const meta = getNotionMeta(fieldSchema as ZodType);
    if (!meta) continue;
    const extractor = meta.extractor;
    if (!extractor) continue;
    if (extractor === "id" || extractor === "markdown") continue;
    const property = meta.notionProperty ?? key;
    if (property === "__icon__") continue;
    names.push(property);
  }
  return names;
}

interface FieldMeta {
  extractor: ExtractorType;
  notionProperty: string;
}

/** Map each TypeScript field name to its extractor and Notion property name. */
function buildFieldMap(shape: ZodRawShape): Map<string, FieldMeta> {
  const fields = new Map<string, FieldMeta>();
  for (const [key, fieldSchema] of Object.entries(shape)) {
    const meta = getNotionMeta(fieldSchema as ZodType);
    if (!meta?.extractor) continue;
    fields.set(key, {
      extractor: meta.extractor,
      notionProperty: meta.notionProperty ?? key,
    });
  }
  return fields;
}

function isWritableExtractor(
  extractor: ExtractorType,
): extractor is CreatableExtractor {
  return CREATABLE_EXTRACTORS.has(extractor as CreatableExtractor);
}

/**
 * Translate simplified property inputs (keyed by TypeScript field name) into
 * Notion's verbose property format (keyed by Notion property name).
 *
 * Only TypeScript field names are accepted. Unknown keys and read-only fields
 * are reported through `client.warn()` instead of being written silently.
 */
function translateProperties(
  shape: ZodRawShape,
  props: Record<string, unknown>,
  client: NormClient,
): Record<string, unknown> {
  const fields = buildFieldMap(shape);

  // Notion property name → TypeScript field name, for helpful warnings.
  const byNotionName = new Map<string, string>();
  for (const [key, field] of fields) {
    if (!byNotionName.has(field.notionProperty)) {
      byNotionName.set(field.notionProperty, key);
    }
  }

  const translated: Record<string, unknown> = {};
  for (const [fieldKey, value] of Object.entries(props)) {
    const field = fields.get(fieldKey);

    if (!field) {
      const suggestion = byNotionName.get(fieldKey);
      client.warn(
        suggestion
          ? `Unknown property "${fieldKey}". Did you mean the TypeScript field "${suggestion}"?`
          : `Unknown property "${fieldKey}" — it is not declared in the model schema.`,
        { property: fieldKey },
      );
      continue;
    }

    if (!isWritableExtractor(field.extractor)) {
      client.warn(
        `Property "${fieldKey}" is read-only and cannot be written.`,
        { property: fieldKey },
      );
      continue;
    }

    if (value === undefined) continue;

    translated[field.notionProperty] = translateProperty(
      field.extractor,
      value,
    );
  }
  return translated;
}
