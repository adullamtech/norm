import { describe, it, expect, vi, beforeEach } from "vitest";
import { NormClient } from "../src/client";
import { n } from "../src/builders";
import type { getType } from "../src/builders";
import type { NormConfig } from "../src/types";
import { lessons, cohorts } from "./fixtures";

function makeMockClient() {
  return {
    dataSources: { query: vi.fn() },
    pages: {
      retrieve: vi.fn(),
      retrieveMarkdown: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      updateMarkdown: vi.fn(),
    },
    blocks: { children: { append: vi.fn() } },
    fileUploads: { create: vi.fn(), send: vi.fn() },
  };
}

function makeNorm(mockClient: ReturnType<typeof makeMockClient>): NormClient {
  return new NormClient({
    client: mockClient as unknown as NormConfig["client"],
    onWarn: vi.fn(),
    onError: vi.fn(),
  });
}

describe("norm.object (model factory)", () => {
  let mockClient: ReturnType<typeof makeMockClient>;
  let norm: NormClient;

  beforeEach(() => {
    mockClient = makeMockClient();
    norm = makeNorm(mockClient);
  });

  describe("auto-injects id", () => {
    it("auto-injects id: n.id() when not present", () => {
      const Model = norm.object({
        title: n.title(),
      });

      // propertyNames excludes id, so it should not be in the list
      expect(Model.propertyNames).toEqual(["title"]);
    });

    it("does not re-inject id when already present", () => {
      const Model = norm.object({
        id: n.id(),
        title: n.title(),
      });

      expect(Model.propertyNames).toEqual(["title"]);
    });
  });

  describe("propertyNames", () => {
    it("collects property names from n.* builders", () => {
      const Model = norm.object({
        title: n.title(),
        order: n.number({ property: "order" }),
        youtubeUrl: n.url({ property: "youtube_url" }),
      });

      expect(Model.propertyNames).toEqual(["title", "order", "youtube_url"]);
    });

    it("excludes markdown from propertyNames", () => {
      const Model = norm.object({
        title: n.title(),
        markdownContent: n.markdown().optional(),
      });

      expect(Model.propertyNames).toEqual(["title"]);
    });
  });

  describe("parse", () => {
    it("parses valid data", () => {
      const Model = norm.object({
        id: n.id(),
        title: n.title(),
      });

      const result = Model.parse({ id: "p1", title: "Hello" });
      expect(result).toEqual({ id: "p1", title: "Hello" });
    });
  });

  describe("parsePage", () => {
    it("extracts fields from a Notion page", async () => {
      const Model = norm.object({
        title: n.title(),
        order: n.number({ property: "order" }),
        youtubeUrl: n.url({ property: "youtube_url" }),
      });

      const result = await Model.parsePage(lessons["lesson-1"]!);
      expect(result.title).toBe("Getting Started");
      expect(result.order).toBe(1);
      expect(result.youtubeUrl).toBe("https://youtube.com/watch?v=video1");
    });

    it("auto-injects id from page.id", async () => {
      const Model = norm.object({
        title: n.title(),
      });

      const result = await Model.parsePage(lessons["lesson-1"]!);
      expect(result.id).toBe("lesson-1");
    });
  });

  describe("retrieve", () => {
    it("calls getPageById with filterProperties and returns parsed data", async () => {
      mockClient.pages.retrieve.mockResolvedValue(lessons["lesson-1"]!);
      mockClient.pages.retrieveMarkdown.mockResolvedValue({ markdown: "" });

      const Model = norm.object({
        title: n.title(),
        order: n.number({ property: "order" }),
      });

      const result = await Model.retrieve("lesson-1");

      expect(mockClient.pages.retrieve).toHaveBeenCalledWith(
        expect.objectContaining({
          page_id: "lesson-1",
          filter_properties: ["title", "order"],
        }),
      );
      expect(result?.title).toBe("Getting Started");
      expect(result?.order).toBe(1);
    });

    it("returns null when page not found", async () => {
      mockClient.pages.retrieve.mockResolvedValue(null);
      const Model = norm.object({ title: n.title() });
      const result = await Model.retrieve("nonexistent");
      expect(result).toBeNull();
    });
  });

  describe("query", () => {
    it("queries database with filterProperties and returns parsed array", async () => {
      mockClient.dataSources.query.mockResolvedValue({
        results: [lessons["lesson-1"]!, lessons["lesson-2"]!],
      });
      mockClient.pages.retrieveMarkdown.mockResolvedValue({ markdown: "" });

      const Model = norm.object({
        title: n.title(),
        order: n.number({ property: "order" }),
      });

      const results = (await Model.query("ds_lessons", {
        filter: { property: "published", checkbox: { equals: true } },
        sorts: [{ property: "order", direction: "ascending" }],
      })) as Array<{ title: string }>;

      expect(mockClient.dataSources.query).toHaveBeenCalledWith(
        expect.objectContaining({
          data_source_id: "ds_lessons",
          filter: { property: "published", checkbox: { equals: true } },
          filter_properties: ["title", "order"],
        }),
      );
      expect(results).toHaveLength(2);
      expect(results[0]!.title).toBe("Getting Started");
      expect(results[1]!.title).toBe("Core Concepts");
    });
  });

  describe("iteratedQuery", () => {
    it("yields a single batch when no pagination needed", async () => {
      mockClient.dataSources.query.mockResolvedValue({
        results: [lessons["lesson-1"]!, lessons["lesson-2"]!],
        has_more: false,
        next_cursor: null,
      });
      mockClient.pages.retrieveMarkdown.mockResolvedValue({ markdown: "" });

      const Model = norm.object({
        title: n.title(),
        order: n.number({ property: "order" }),
      });

      const batches: unknown[][] = [];
      for await (const batch of Model.iteratedQuery("ds_lessons")) {
        batches.push(batch);
      }

      expect(batches).toHaveLength(1);
      expect(batches[0]).toHaveLength(2);
      expect((batches[0]![0] as { title: string }).title).toBe(
        "Getting Started",
      );
      expect((batches[0]![1] as { title: string }).title).toBe("Core Concepts");
      expect(mockClient.dataSources.query).toHaveBeenCalledTimes(1);
      expect(mockClient.dataSources.query).toHaveBeenCalledWith(
        expect.objectContaining({
          data_source_id: "ds_lessons",
          filter_properties: ["title", "order"],
        }),
      );
    });

    it("paginates through multiple pages via cursor", async () => {
      mockClient.dataSources.query
        .mockResolvedValueOnce({
          results: [lessons["lesson-1"]!],
          has_more: true,
          next_cursor: "cursor-abc",
        })
        .mockResolvedValueOnce({
          results: [lessons["lesson-2"]!],
          has_more: false,
          next_cursor: null,
        });
      mockClient.pages.retrieveMarkdown.mockResolvedValue({ markdown: "" });

      const Model = norm.object({
        title: n.title(),
        order: n.number({ property: "order" }),
      });

      const batches: unknown[][] = [];
      for await (const batch of Model.iteratedQuery("ds_lessons")) {
        batches.push(batch);
      }

      expect(batches).toHaveLength(2);
      expect((batches[0]![0] as { title: string }).title).toBe(
        "Getting Started",
      );
      expect((batches[1]![0] as { title: string }).title).toBe("Core Concepts");

      // Second call should use the cursor
      expect(mockClient.dataSources.query).toHaveBeenCalledTimes(2);
      expect(mockClient.dataSources.query).toHaveBeenNthCalledWith(
        2,
        expect.objectContaining({
          start_cursor: "cursor-abc",
        }),
      );
    });

    it("passes filter and sorts through to query", async () => {
      mockClient.dataSources.query.mockResolvedValue({
        results: [lessons["lesson-1"]!],
        has_more: false,
        next_cursor: null,
      });
      mockClient.pages.retrieveMarkdown.mockResolvedValue({ markdown: "" });

      const Model = norm.object({
        title: n.title(),
        order: n.number({ property: "order" }),
      });

      const filter = {
        property: "published",
        checkbox: { equals: true },
      };
      const sorts = [{ property: "order", direction: "ascending" as const }];

      const batches: unknown[][] = [];
      for await (const batch of Model.iteratedQuery("ds_lessons", {
        filter,
        sorts,
      })) {
        batches.push(batch);
      }

      expect(mockClient.dataSources.query).toHaveBeenCalledWith(
        expect.objectContaining({
          data_source_id: "ds_lessons",
          filter,
          sorts,
          filter_properties: ["title", "order"],
        }),
      );
      expect(batches).toHaveLength(1);
    });

    it("yields one empty batch for empty results", async () => {
      mockClient.dataSources.query.mockResolvedValue({
        results: [],
        has_more: false,
        next_cursor: null,
      });

      const Model = norm.object({
        title: n.title(),
      });

      const batches: unknown[][] = [];
      for await (const batch of Model.iteratedQuery("ds_lessons")) {
        batches.push(batch);
      }

      expect(batches).toHaveLength(1);
      expect(batches[0]).toHaveLength(0);
      expect(mockClient.dataSources.query).toHaveBeenCalledTimes(1);
    });

    it("sends empty startCursor on first call", async () => {
      mockClient.dataSources.query.mockResolvedValue({
        results: [lessons["lesson-1"]!],
        has_more: false,
        next_cursor: null,
      });
      mockClient.pages.retrieveMarkdown.mockResolvedValue({ markdown: "" });

      const Model = norm.object({
        title: n.title(),
      });

      for await (const _batch of Model.iteratedQuery("ds_lessons")) {
        void _batch;
      }

      expect(mockClient.dataSources.query).toHaveBeenCalledWith(
        expect.objectContaining({
          start_cursor: undefined,
        }),
      );
    });
  });

  describe("create", () => {
    it("translates simplified properties to Notion format and calls createPage", async () => {
      mockClient.pages.create.mockResolvedValue({ id: "new-page-1" });

      const Model = norm.object({
        title: n.title(),
        order: n.number({ property: "order" }),
        published: n.checkbox({ property: "published" }),
        youtubeUrl: n.url({ property: "youtube_url" }),
      });

      const result = await Model.create({
        parent: { data_source_id: "ds_123" },
        properties: {
          title: "New Lesson",
          order: 10,
          published: true,
          youtubeUrl: "https://youtube.com/watch?v=abc",
        },
        markdown: "# Content",
      });

      expect(mockClient.pages.create).toHaveBeenCalledWith(
        expect.objectContaining({
          parent: { data_source_id: "ds_123" },
          markdown: "# Content",
        }),
      );
      expect(result).toBe("new-page-1");

      // Verify the properties were translated
      const call = mockClient.pages.create.mock.calls[0]![0] as {
        properties: Record<string, unknown>;
      };
      expect(call.properties.title).toEqual({
        title: [{ text: { content: "New Lesson" } }],
      });
      expect(call.properties.order).toEqual({ number: 10 });
      expect(call.properties.published).toEqual({ checkbox: true });
      expect(call.properties.youtube_url).toEqual({
        url: "https://youtube.com/watch?v=abc",
      });
    });

    it("handles null values", async () => {
      mockClient.pages.create.mockResolvedValue({ id: "new-page-1" });

      const Model = norm.object({
        title: n.title(),
        order: n.number({ property: "order" }),
        youtubeUrl: n.url({ property: "youtube_url" }),
      });

      await Model.create({
        parent: { data_source_id: "ds_123" },
        properties: {
          title: "Test",
          order: null,
          youtubeUrl: null,
        },
      });

      const call = mockClient.pages.create.mock.calls[0]![0] as {
        properties: Record<string, unknown>;
      };
      expect(call.properties.order).toEqual({ number: null });
      expect(call.properties.youtube_url).toEqual({ url: null });
    });

    it("translates relation and multiSelect", async () => {
      mockClient.pages.create.mockResolvedValue({ id: "new-page-1" });

      const Model = norm.object({
        title: n.title(),
        week: n.relation({ property: "week" }),
        related: n.multiRelation({ property: "related" }),
        tags: n.multiSelect({ property: "tags" }),
      });

      await Model.create({
        parent: { data_source_id: "ds_123" },
        properties: {
          title: "Test",
          week: "week-1",
          related: ["week-2", "week-3"],
          tags: ["a", "b"],
        },
      });

      const call = mockClient.pages.create.mock.calls[0]![0] as {
        properties: Record<string, unknown>;
      };
      expect(call.properties.week).toEqual({
        relation: [{ id: "week-1" }],
      });
      expect(call.properties.related).toEqual({
        relation: [{ id: "week-2" }, { id: "week-3" }],
      });
      expect(call.properties.tags).toEqual({
        multi_select: [{ name: "a" }, { name: "b" }],
      });
    });

    it("maps TypeScript field names to Notion property names", async () => {
      mockClient.pages.create.mockResolvedValue({ id: "new-page-1" });

      const Model = norm.object({
        title: n.title(),
        price: n.number({ property: "Price" }),
        status: n.select({
          property: "Status",
          enum: ["active", "draft"],
        }),
        inStock: n.checkbox({ property: "In Stock" }),
      });

      await Model.create({
        parent: { data_source_id: "ds_123" },
        properties: {
          title: "Keyboard",
          price: 149.99,
          status: "active",
          inStock: true,
        },
      });

      const call = mockClient.pages.create.mock.calls[0]![0] as {
        properties: Record<string, unknown>;
      };
      expect(call.properties.Price).toEqual({ number: 149.99 });
      expect(call.properties.Status).toEqual({
        select: { name: "active" },
      });
      expect(call.properties["In Stock"]).toEqual({ checkbox: true });
      expect(call.properties.price).toBeUndefined();
      expect(call.properties.status).toBeUndefined();
    });

    it("rejects Notion property names and warns", async () => {
      const onWarn = vi.fn();
      const normWithWarn = new NormClient({
        client: mockClient as unknown as NormConfig["client"],
        onWarn,
      });
      mockClient.pages.create.mockResolvedValue({ id: "new-page-1" });

      const Model = normWithWarn.object({
        youtubeUrl: n.url({ property: "youtube_url" }),
      });

      await Model.create({
        parent: { data_source_id: "ds_123" },
        properties: {
          // @ts-expect-error — Notion property names are not accepted
          youtube_url: "https://youtube.com/watch?v=abc",
        },
      });

      expect(onWarn).toHaveBeenCalledWith(
        'Unknown property "youtube_url". Did you mean the TypeScript field "youtubeUrl"?',
        { property: "youtube_url" },
      );

      const call = mockClient.pages.create.mock.calls[0]![0] as {
        properties: Record<string, unknown>;
      };
      expect(call.properties).toEqual({});
    });

    it("warns instead of writing read-only fields", async () => {
      const onWarn = vi.fn();
      const normWithWarn = new NormClient({
        client: mockClient as unknown as NormConfig["client"],
        onWarn,
      });
      mockClient.pages.create.mockResolvedValue({ id: "new-page-1" });

      const Model = normWithWarn.object({
        title: n.title(),
        computed: n.rollupText({ property: "Computed" }),
      });

      await Model.create({
        parent: { data_source_id: "ds_123" },
        properties: {
          title: "Test",
          // @ts-expect-error — rollups are read-only
          computed: "nope",
        },
      });

      expect(onWarn).toHaveBeenCalledWith(
        'Property "computed" is read-only and cannot be written.',
        { property: "computed" },
      );

      const call = mockClient.pages.create.mock.calls[0]![0] as {
        properties: Record<string, unknown>;
      };
      expect(call.properties).toEqual({
        title: { title: [{ text: { content: "Test" } }] },
      });
    });

    it("keeps optional fields optional", async () => {
      mockClient.pages.create.mockResolvedValue({ id: "new-page-1" });

      const Model = norm.object({
        title: n.title(),
        sku: n.richText({ property: "SKU" }).optional(),
      });

      await Model.create({
        parent: { data_source_id: "ds_123" },
        properties: { title: "No SKU" },
      });

      const call = mockClient.pages.create.mock.calls[0]![0] as {
        properties: Record<string, unknown>;
      };
      expect(call.properties).toEqual({
        title: { title: [{ text: { content: "No SKU" } }] },
      });
    });

    it("keeps defaulted fields optional", async () => {
      mockClient.pages.create.mockResolvedValue({ id: "new-page-1" });

      const Model = norm.object({
        title: n.title({ property: "Name" }),
        currency: n.richText({ property: "Currency" }).default("USD"),
      });

      await Model.create({
        parent: { data_source_id: "ds_123" },
        properties: { title: "No currency" },
      });

      const call = mockClient.pages.create.mock.calls[0]![0] as {
        properties: Record<string, unknown>;
      };
      expect(call.properties).toEqual({
        Name: { title: [{ text: { content: "No currency" } }] },
      });
    });
  });

  describe("update", () => {
    it("translates simplified properties to Notion format and calls updatePage", async () => {
      mockClient.pages.update.mockResolvedValue({
        id: "page-1",
        properties: {},
      });

      const Model = norm.object({
        title: n.title(),
        order: n.number({ property: "order" }),
        published: n.checkbox({ property: "published" }),
        youtubeUrl: n.url({ property: "youtube_url" }),
      });

      const result = await Model.update({
        pageId: "page-1",
        properties: {
          title: "Updated Lesson",
          order: 20,
          published: false,
          youtubeUrl: "https://youtube.com/watch?v=updated",
        },
      });

      expect(mockClient.pages.update).toHaveBeenCalledWith(
        expect.objectContaining({
          page_id: "page-1",
        }),
      );
      expect(result).toBe(true);

      // Verify the properties were translated
      const call = mockClient.pages.update.mock.calls[0]![0] as {
        properties: Record<string, unknown>;
      };
      expect(call.properties.title).toEqual({
        title: [{ text: { content: "Updated Lesson" } }],
      });
      expect(call.properties.order).toEqual({ number: 20 });
      expect(call.properties.published).toEqual({ checkbox: false });
      expect(call.properties.youtube_url).toEqual({
        url: "https://youtube.com/watch?v=updated",
      });
    });

    it("handles null values", async () => {
      mockClient.pages.update.mockResolvedValue({
        id: "page-1",
        properties: {},
      });

      const Model = norm.object({
        title: n.title(),
        order: n.number({ property: "order" }),
        youtubeUrl: n.url({ property: "youtube_url" }),
      });

      await Model.update({
        pageId: "page-1",
        properties: {
          order: null,
          youtubeUrl: null,
        },
      });

      const call = mockClient.pages.update.mock.calls[0]![0] as {
        properties: Record<string, unknown>;
      };
      expect(call.properties.order).toEqual({ number: null });
      expect(call.properties.youtube_url).toEqual({ url: null });
    });

    it("translates relation and multiSelect", async () => {
      mockClient.pages.update.mockResolvedValue({
        id: "page-1",
        properties: {},
      });

      const Model = norm.object({
        title: n.title(),
        week: n.relation({ property: "week" }),
        related: n.multiRelation({ property: "related" }),
        tags: n.multiSelect({ property: "tags" }),
      });

      await Model.update({
        pageId: "page-1",
        properties: {
          week: "week-1",
          related: ["week-2", "week-3"],
          tags: ["a", "b"],
        },
      });

      const call = mockClient.pages.update.mock.calls[0]![0] as {
        properties: Record<string, unknown>;
      };
      expect(call.properties.week).toEqual({
        relation: [{ id: "week-1" }],
      });
      expect(call.properties.related).toEqual({
        relation: [{ id: "week-2" }, { id: "week-3" }],
      });
      expect(call.properties.tags).toEqual({
        multi_select: [{ name: "a" }, { name: "b" }],
      });
    });

    it("supports partial property updates", async () => {
      mockClient.pages.update.mockResolvedValue({
        id: "page-1",
        properties: {},
      });

      const Model = norm.object({
        title: n.title(),
        order: n.number({ property: "order" }),
        published: n.checkbox({ property: "published" }),
      });

      await Model.update({
        pageId: "page-1",
        properties: {
          order: 99,
        },
      });

      const call = mockClient.pages.update.mock.calls[0]![0] as {
        properties: Record<string, unknown>;
      };
      expect(call.properties.order).toEqual({ number: 99 });
      expect(call.properties.title).toBeUndefined();
      expect(call.properties.published).toBeUndefined();
    });

    it("updates only markdown when properties are empty", async () => {
      mockClient.pages.updateMarkdown.mockResolvedValue({ markdown: "# New" });

      const Model = norm.object({
        title: n.title(),
      });

      const result = await Model.update({
        pageId: "page-1",
        properties: {},
        markdown: "# New content",
      });

      expect(result).toBe(true);
      expect(mockClient.pages.update).not.toHaveBeenCalled();
      expect(mockClient.pages.updateMarkdown).toHaveBeenCalledWith(
        expect.objectContaining({
          page_id: "page-1",
          replace_content: { new_str: "# New content" },
        }),
      );
    });

    it("returns false when there is nothing to update", async () => {
      const Model = norm.object({
        title: n.title(),
      });

      const result = await Model.update({
        pageId: "page-1",
        properties: {},
      });

      expect(result).toBe(false);
      expect(mockClient.pages.update).not.toHaveBeenCalled();
      expect(mockClient.pages.updateMarkdown).not.toHaveBeenCalled();
    });

    it("updates markdown via updatePageMarkdown when provided", async () => {
      mockClient.pages.update.mockResolvedValue({
        id: "page-1",
        properties: {},
      });
      mockClient.pages.updateMarkdown.mockResolvedValue({ markdown: "# New" });

      const Model = norm.object({
        title: n.title(),
        markdownContent: n.markdown().optional(),
      });

      const result = await Model.update({
        pageId: "page-1",
        properties: {
          title: "Updated Title",
        },
        markdown: "# New content",
      });

      expect(result).toBe(true);
      expect(mockClient.pages.updateMarkdown).toHaveBeenCalledWith(
        expect.objectContaining({
          page_id: "page-1",
          type: "replace_content",
          replace_content: { new_str: "# New content" },
        }),
      );
    });

    it("skips markdown update when not provided", async () => {
      mockClient.pages.update.mockResolvedValue({
        id: "page-1",
        properties: {},
      });

      const Model = norm.object({
        title: n.title(),
      });

      await Model.update({
        pageId: "page-1",
        properties: { title: "Updated" },
      });

      expect(mockClient.pages.updateMarkdown).not.toHaveBeenCalled();
    });

    it("returns false when updatePage fails", async () => {
      mockClient.pages.update.mockRejectedValue(new Error("update failed"));

      const Model = norm.object({
        title: n.title(),
      });

      const result = await Model.update({
        pageId: "page-1",
        properties: { title: "Updated" },
      });

      expect(result).toBe(false);
      // Markdown should not be attempted when properties update fails
      expect(mockClient.pages.updateMarkdown).not.toHaveBeenCalled();
    });
  });

  describe("n.getType", () => {
    it("extracts the output type", () => {
      const Model = norm.object({
        title: n.title(),
        order: n.number({ property: "order" }),
      });
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      const _model = Model;

      // Type-level test — if this compiles, getType works
      type T = getType<typeof Model>;
      const val: T = { id: "p1", title: "hello", order: 5 } as T;
      expect((val as { title: string }).title).toBe("hello");
    });
  });

  describe("transform option", () => {
    it("applies transform to the parsed output", async () => {
      const Model = norm.object(
        {
          option1: n.richText({ property: "option_1" }),
          option2: n.richText({ property: "option_2" }),
        },
        {
          transform: (data) => ({
            options: [data.option1, data.option2] as [string, string],
          }),
        },
      );

      const page = {
        ...cohorts["cohort-1"]!,
        properties: {
          option_1: {
            type: "rich_text",
            rich_text: [
              {
                plain_text: "A",
                text: { content: "A", link: null },
                type: "text",
                href: null,
                annotations: {},
              },
            ],
          },
          option_2: {
            type: "rich_text",
            rich_text: [
              {
                plain_text: "B",
                text: { content: "B", link: null },
                type: "text",
                href: null,
                annotations: {},
              },
            ],
          },
        },
      };

      const result = await Model.parsePage(page as never);
      expect(result.options).toEqual(["A", "B"]);
    });
  });
});
