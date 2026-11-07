import type { Client } from "@notionhq/client";
import type {
  BlockObjectRequest,
  CreatePageParameters,
  GetPageParameters,
  PageObjectResponse,
  QueryDataSourceParameters,
  UpdatePageParameters,
  UpdatePageMarkdownParameters,
} from "@notionhq/client/build/src/api-endpoints";
import type { z, ZodType, ZodRawShape, ZodObject } from "zod";
import type {
  NormConfig,
  RetrieveOptions,
  QueryDatabaseResult,
  CreatePageInput,
  UpdatePageInput,
  GetPageByIdOptions,
  NormAttachment,
  WritableProps,
} from "./types";
import {
  retrieveFromPage,
  retrievePage,
  getSchemaShape,
  getNotionMeta,
} from "./retriever";
import { defineObject, type NormModel } from "./model";

export class NormClient {
  /** Resolved Notion Client (set eagerly or lazily). */
  private _client?: Client;
  /** Factory for lazy-loading the Notion Client. */
  private _clientFactory?: () => Client | Promise<Client>;
  /** Guards against concurrent factory invocations. */
  private _clientPromise?: Promise<Client>;

  private readonly onWarn?: (msg: string, ctx: Record<string, unknown>) => void;
  private readonly onError?: (err: Error, ctx: Record<string, unknown>) => void;

  constructor(config: NormConfig) {
    if (typeof config.client === "function") {
      this._clientFactory = config.client;
    } else {
      this._client = config.client;
    }
    this.onWarn = config.onWarn;
    this.onError = config.onError;
  }

  /**
   * Returns the Notion Client, resolving the factory on first call if
   * lazy-loading was configured. The factory is invoked at most once;
   * concurrent calls are deduplicated.
   */
  async getNotion(): Promise<Client> {
    if (this._client) return this._client;
    if (!this._clientPromise) {
      this._clientPromise = Promise.resolve(this._clientFactory!()).then(
        (client) => {
          this._client = client;
          return client;
        },
      );
    }
    return this._clientPromise;
  }

  async queryDatabase(
    dataSourceId: string,
    opts: {
      filter?: QueryDataSourceParameters["filter"];
      sorts?: QueryDataSourceParameters["sorts"];
      filterProperties?: string[];
      pageSize?: number;
      startCursor?: string;
    } = { pageSize: 100 },
  ): Promise<QueryDatabaseResult> {
    try {
      const client = await this.getNotion();
      const response = await client.dataSources.query({
        data_source_id: dataSourceId,
        filter: opts.filter,
        sorts: opts.sorts,
        filter_properties: opts.filterProperties,
        page_size: opts.pageSize,
        start_cursor: opts.startCursor,
      });
      return {
        results: response.results as PageObjectResponse[],
        pageSize: response.results.length,
        hasMore: response.has_more,
        nextCursor: response.next_cursor ?? undefined,
      };
    } catch (error) {
      this.onError?.(error as Error, { dataSourceId });
      return { results: [], pageSize: 0 };
    }
  }

  async getPageById(
    pageId: string,
    opts?: GetPageByIdOptions,
  ): Promise<PageObjectResponse | null> {
    try {
      const params: GetPageParameters = {
        page_id: pageId,
        filter_properties: opts?.filterProperties,
      };
      const client = await this.getNotion();
      const response = await client.pages.retrieve(params);
      if (!response || !("properties" in response)) {
        this.onWarn?.("Page retrieved has no properties", { pageId });
        return null;
      }
      return response as PageObjectResponse;
    } catch (error) {
      this.onError?.(error as Error, { pageId });
      return null;
    }
  }

  async getPageMarkdown(pageId: string): Promise<string> {
    try {
      const client = await this.getNotion();
      const response = await client.pages.retrieveMarkdown({
        page_id: pageId,
      });
      return response.markdown;
    } catch (error) {
      this.onError?.(error as Error, { pageId });
      return "";
    }
  }

  async createPage(input: CreatePageInput): Promise<string | null> {
    try {
      const client = await this.getNotion();
      const response = await client.pages.create({
        parent: input.parent as CreatePageParameters["parent"],
        properties: input.properties as CreatePageParameters["properties"],
        markdown: input.markdown,
      });
      return response.id;
    } catch (error) {
      this.onError?.(error as Error, { parent: input.parent });
      return null;
    }
  }

  async updatePage(input: UpdatePageInput): Promise<boolean> {
    try {
      const client = await this.getNotion();
      const properties = input.properties as
        | UpdatePageParameters["properties"]
        | undefined;

      if (properties && Object.keys(properties).length > 0) {
        await client.pages.update({
          page_id: input.pageId,
          properties,
        });
      }

      if (input.markdown !== undefined) {
        return this.updatePageMarkdown(input.pageId, input.markdown);
      }

      return true;
    } catch (error) {
      this.onError?.(error as Error, { pageId: input.pageId });
      return false;
    }
  }

  /** @internal Used by the model layer to surface non-fatal write issues. */
  warn(msg: string, ctx: Record<string, unknown> = {}): void {
    this.onWarn?.(msg, ctx);
  }

  async updatePageMarkdown(pageId: string, markdown: string): Promise<boolean> {
    try {
      const client = await this.getNotion();
      await client.pages.updateMarkdown({
        page_id: pageId,
        type: "replace_content",
        replace_content: { new_str: markdown },
      } as UpdatePageMarkdownParameters);
      return true;
    } catch (error) {
      this.onError?.(error as Error, { pageId });
      return false;
    }
  }

  async uploadFile(file: {
    filename: string;
    contentType: string;
    data: Buffer;
  }): Promise<string | null> {
    try {
      const client = await this.getNotion();
      const createResponse = await client.fileUploads.create({
        mode: "single_part",
        filename: file.filename,
        content_type: file.contentType,
      });

      if (!createResponse.id) {
        this.onWarn?.("File upload creation returned no id", {
          filename: file.filename,
        });
        return null;
      }

      await client.fileUploads.send({
        file_upload_id: createResponse.id,
        file: {
          filename: file.filename,
          data: new Blob([new Uint8Array(file.data)], {
            type: file.contentType,
          }),
        },
      });

      return createResponse.id;
    } catch (error) {
      this.onError?.(error as Error, { filename: file.filename });
      return null;
    }
  }

  async appendFileBlocks(
    pageId: string,
    attachments: NormAttachment[],
  ): Promise<boolean> {
    if (attachments.length === 0) return true;

    try {
      const children: BlockObjectRequest[] = attachments.map((attachment) => {
        if (attachment.blockType === "file") {
          return {
            file: {
              file_upload: { id: attachment.fileUploadId },
              name: attachment.filename ?? "Attachment",
            },
            type: "file",
            object: "block",
          } as BlockObjectRequest;
        }
        return {
          [attachment.blockType]: {
            file_upload: { id: attachment.fileUploadId },
          },
          type: attachment.blockType,
          object: "block",
        } as BlockObjectRequest;
      });

      const client = await this.getNotion();
      await client.blocks.children.append({
        block_id: pageId,
        children,
      });

      return true;
    } catch (error) {
      this.onError?.(error as Error, { pageId });
      return false;
    }
  }

  async retrievePage<T extends ZodType>(
    pageId: string,
    schema: T,
    options?: RetrieveOptions,
    propertyNames?: readonly string[],
  ): Promise<z.infer<T> | null> {
    return retrievePage(
      pageId,
      schema,
      (id, opts) => this.getPageById(id, opts),
      (id) => this.getPageMarkdown(id),
      options,
      propertyNames,
    );
  }

  async retrieveFromPage<T extends ZodType>(
    page: PageObjectResponse,
    schema: T,
    options?: RetrieveOptions,
  ): Promise<z.infer<T>> {
    return retrieveFromPage(page, schema, options, {
      getPageMarkdown: (id) => this.getPageMarkdown(id),
    });
  }

  /**
   * Collect the Notion property names declared in a schema, excluding id,
   * markdownContent. Used for auto filter_properties.
   */
  collectPropertyNames(schema: ZodType): string[] {
    const shape = getSchemaShape(schema);
    const names: string[] = [];
    for (const [key, fieldSchema] of Object.entries(shape)) {
      const meta = getNotionMeta(fieldSchema);
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

  /**
   * Define a Notion model bound to this client. Auto-injects `id: n.id()`
   * if not present in the shape.
   */
  object<TShape extends ZodRawShape, TTransform = never>(
    shape: TShape,
    opts?: {
      transform?: (
        data: z.infer<ZodObject<{ id: z.ZodString } & TShape>>,
      ) => TTransform;
    },
  ): NormModel<
    [TTransform] extends [never]
      ? z.infer<ZodObject<{ id: z.ZodString } & TShape>>
      : TTransform,
    WritableProps<TShape>
  > {
    return defineObject(this, shape, opts as never) as never;
  }
}
