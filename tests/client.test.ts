import { describe, it, expect, vi, beforeEach } from "vitest";
import { NormClient } from "../src/client";
import type { NormConfig } from "../src/types";

function makeMockClient() {
  return {
    dataSources: {
      query: vi.fn(),
    },
    pages: {
      retrieve: vi.fn(),
      retrieveMarkdown: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      updateMarkdown: vi.fn(),
    },
    blocks: {
      children: {
        append: vi.fn(),
      },
    },
    fileUploads: {
      create: vi.fn(),
      send: vi.fn(),
    },
  };
}

function makeNorm(mockClient: ReturnType<typeof makeMockClient>): NormClient {
  return new NormClient({
    client: mockClient as unknown as NormConfig["client"],
    onWarn: vi.fn(),
    onError: vi.fn(),
  });
}

describe("NormClient", () => {
  let mockClient: ReturnType<typeof makeMockClient>;
  let norm: NormClient;

  beforeEach(() => {
    mockClient = makeMockClient();
    norm = makeNorm(mockClient);
  });

  describe("queryDatabase", () => {
    it("calls dataSources.query with the right args", async () => {
      mockClient.dataSources.query.mockResolvedValue({ results: [] });
      await norm.queryDatabase("ds_123", {
        filter: { property: "x", checkbox: { equals: true } },
        sorts: [{ property: "order", direction: "ascending" }],
        filterProperties: ["title", "order"],
      });

      expect(mockClient.dataSources.query).toHaveBeenCalledWith({
        data_source_id: "ds_123",
        filter: { property: "x", checkbox: { equals: true } },
        sorts: [{ property: "order", direction: "ascending" }],
        filter_properties: ["title", "order"],
      });
    });

    it("returns results array on success", async () => {
      mockClient.dataSources.query.mockResolvedValue({
        results: [{ id: "p1" }],
      });
      const result = await norm.queryDatabase("ds_123");
      expect(result.results).toHaveLength(1);
    });

    it("returns empty results and calls onError on failure", async () => {
      const onError = vi.fn();
      const normWithHandler = new NormClient({
        client: mockClient as unknown as NormConfig["client"],
        onError,
      });
      mockClient.dataSources.query.mockRejectedValue(new Error("API down"));

      const result = await normWithHandler.queryDatabase("ds_123");
      expect(result.results).toEqual([]);
      expect(onError).toHaveBeenCalledWith(expect.any(Error), {
        dataSourceId: "ds_123",
      });
    });
  });

  describe("getPageById", () => {
    it("calls pages.retrieve with page_id and filter_properties", async () => {
      mockClient.pages.retrieve.mockResolvedValue({
        object: "page",
        id: "p1",
        properties: {},
      });
      await norm.getPageById("p1", { filterProperties: ["title"] });

      expect(mockClient.pages.retrieve).toHaveBeenCalledWith(
        expect.objectContaining({
          page_id: "p1",
          filter_properties: ["title"],
        }),
      );
    });

    it("returns null when response has no properties", async () => {
      mockClient.pages.retrieve.mockResolvedValue({ object: "page", id: "p1" });
      const result = await norm.getPageById("p1");
      expect(result).toBeNull();
    });

    it("returns null and calls onError on failure", async () => {
      const onError = vi.fn();
      const normWithHandler = new NormClient({
        client: mockClient as unknown as NormConfig["client"],
        onError,
      });
      mockClient.pages.retrieve.mockRejectedValue(new Error("Not found"));

      const result = await normWithHandler.getPageById("p1");
      expect(result).toBeNull();
      expect(onError).toHaveBeenCalledWith(expect.any(Error), { pageId: "p1" });
    });
  });

  describe("getPageMarkdown", () => {
    it("returns markdown string on success", async () => {
      mockClient.pages.retrieveMarkdown.mockResolvedValue({
        markdown: "# Hello",
      });
      const result = await norm.getPageMarkdown("p1");
      expect(result).toBe("# Hello");
    });

    it("returns empty string on failure", async () => {
      const onError = vi.fn();
      const normWithHandler = new NormClient({
        client: mockClient as unknown as NormConfig["client"],
        onError,
      });
      mockClient.pages.retrieveMarkdown.mockRejectedValue(new Error("fail"));

      const result = await normWithHandler.getPageMarkdown("p1");
      expect(result).toBe("");
      expect(onError).toHaveBeenCalledWith(expect.any(Error), { pageId: "p1" });
    });
  });

  describe("createPage", () => {
    it("calls pages.create with parent, properties, and markdown", async () => {
      mockClient.pages.create.mockResolvedValue({ id: "new-page-1" });
      const result = await norm.createPage({
        parent: { data_source_id: "ds_123" },
        properties: { title: [{ text: { content: "Hello" } }] },
        markdown: "# Hello",
      });

      expect(mockClient.pages.create).toHaveBeenCalledWith(
        expect.objectContaining({
          parent: { data_source_id: "ds_123" },
          markdown: "# Hello",
        }),
      );
      expect(result).toBe("new-page-1");
    });

    it("returns null and calls onError on failure", async () => {
      const onError = vi.fn();
      const normWithHandler = new NormClient({
        client: mockClient as unknown as NormConfig["client"],
        onError,
      });
      mockClient.pages.create.mockRejectedValue(new Error("create failed"));

      const result = await normWithHandler.createPage({
        parent: {},
        properties: {},
      });
      expect(result).toBeNull();
      expect(onError).toHaveBeenCalledWith(
        expect.any(Error),
        expect.any(Object),
      );
    });
  });

  describe("updatePage", () => {
    it("calls pages.update with page_id and properties", async () => {
      mockClient.pages.update.mockResolvedValue({
        id: "page-1",
        properties: {},
      });
      const result = await norm.updatePage({
        pageId: "page-1",
        properties: { title: [{ text: { content: "Updated" } }] },
      });

      expect(mockClient.pages.update).toHaveBeenCalledWith(
        expect.objectContaining({
          page_id: "page-1",
          properties: { title: [{ text: { content: "Updated" } }] },
        }),
      );
      expect(result).toBe(true);
    });

    it("updates markdown via updatePageMarkdown when provided", async () => {
      mockClient.pages.update.mockResolvedValue({ id: "page-1" });
      mockClient.pages.updateMarkdown.mockResolvedValue({ markdown: "# New" });

      const result = await norm.updatePage({
        pageId: "page-1",
        properties: { title: [{ text: { content: "Updated" } }] },
        markdown: "# New",
      });

      expect(result).toBe(true);
      expect(mockClient.pages.updateMarkdown).toHaveBeenCalledWith(
        expect.objectContaining({
          page_id: "page-1",
          replace_content: { new_str: "# New" },
        }),
      );
    });

    it("skips pages.update when properties are empty", async () => {
      mockClient.pages.updateMarkdown.mockResolvedValue({ markdown: "# New" });

      const result = await norm.updatePage({
        pageId: "page-1",
        properties: {},
        markdown: "# New",
      });

      expect(result).toBe(true);
      expect(mockClient.pages.update).not.toHaveBeenCalled();
      expect(mockClient.pages.updateMarkdown).toHaveBeenCalledTimes(1);
    });

    it("returns false and calls onError on failure", async () => {
      const onError = vi.fn();
      const normWithHandler = new NormClient({
        client: mockClient as unknown as NormConfig["client"],
        onError,
      });
      mockClient.pages.update.mockRejectedValue(new Error("update failed"));

      const result = await normWithHandler.updatePage({
        pageId: "page-1",
        properties: { title: [{ text: { content: "Updated" } }] },
      });
      expect(result).toBe(false);
      expect(onError).toHaveBeenCalledWith(expect.any(Error), {
        pageId: "page-1",
      });
    });
  });

  describe("updatePageMarkdown", () => {
    it("calls pages.updateMarkdown with replace_content strategy", async () => {
      mockClient.pages.updateMarkdown.mockResolvedValue({ markdown: "# New" });
      const result = await norm.updatePageMarkdown("page-1", "# New content");

      expect(mockClient.pages.updateMarkdown).toHaveBeenCalledWith(
        expect.objectContaining({
          page_id: "page-1",
          type: "replace_content",
          replace_content: { new_str: "# New content" },
        }),
      );
      expect(result).toBe(true);
    });

    it("returns false and calls onError on failure", async () => {
      const onError = vi.fn();
      const normWithHandler = new NormClient({
        client: mockClient as unknown as NormConfig["client"],
        onError,
      });
      mockClient.pages.updateMarkdown.mockRejectedValue(
        new Error("markdown failed"),
      );

      const result = await normWithHandler.updatePageMarkdown(
        "page-1",
        "# New",
      );
      expect(result).toBe(false);
      expect(onError).toHaveBeenCalledWith(expect.any(Error), {
        pageId: "page-1",
      });
    });
  });

  describe("uploadFile", () => {
    it("creates a file upload and sends the data", async () => {
      mockClient.fileUploads.create.mockResolvedValue({ id: "file-1" });
      mockClient.fileUploads.send.mockResolvedValue({});
      const result = await norm.uploadFile({
        filename: "test.txt",
        contentType: "text/plain",
        data: Buffer.from("hello"),
      });

      expect(result).toBe("file-1");
      expect(mockClient.fileUploads.create).toHaveBeenCalledWith({
        mode: "single_part",
        filename: "test.txt",
        content_type: "text/plain",
      });
    });

    it("returns null when create returns no id", async () => {
      const onWarn = vi.fn();
      const normWithWarn = new NormClient({
        client: mockClient as unknown as NormConfig["client"],
        onWarn,
      });
      mockClient.fileUploads.create.mockResolvedValue({});

      const result = await normWithWarn.uploadFile({
        filename: "test.txt",
        contentType: "text/plain",
        data: Buffer.from("hello"),
      });
      expect(result).toBeNull();
      expect(onWarn).toHaveBeenCalledWith(expect.any(String), {
        filename: "test.txt",
      });
    });

    it("returns null and calls onError on failure", async () => {
      const onError = vi.fn();
      const normWithHandler = new NormClient({
        client: mockClient as unknown as NormConfig["client"],
        onError,
      });
      mockClient.fileUploads.create.mockRejectedValue(
        new Error("upload failed"),
      );

      const result = await normWithHandler.uploadFile({
        filename: "test.txt",
        contentType: "text/plain",
        data: Buffer.from("hello"),
      });
      expect(result).toBeNull();
      expect(onError).toHaveBeenCalledWith(expect.any(Error), {
        filename: "test.txt",
      });
    });
  });

  describe("appendFileBlocks", () => {
    it("returns true when no attachments", async () => {
      const result = await norm.appendFileBlocks("p1", []);
      expect(result).toBe(true);
      expect(mockClient.blocks.children.append).not.toHaveBeenCalled();
    });

    it("appends blocks and returns true on success", async () => {
      mockClient.blocks.children.append.mockResolvedValue({});
      const result = await norm.appendFileBlocks("p1", [
        { fileUploadId: "f1", filename: "file.pdf", blockType: "file" },
      ]);
      expect(result).toBe(true);
      expect(mockClient.blocks.children.append).toHaveBeenCalledWith({
        block_id: "p1",
        children: expect.any(Array),
      });
    });

    it("returns false and calls onError on failure", async () => {
      const onError = vi.fn();
      const normWithHandler = new NormClient({
        client: mockClient as unknown as NormConfig["client"],
        onError,
      });
      mockClient.blocks.children.append.mockRejectedValue(
        new Error("append failed"),
      );

      const result = await normWithHandler.appendFileBlocks("p1", [
        { fileUploadId: "f1", blockType: "file" },
      ]);
      expect(result).toBe(false);
      expect(onError).toHaveBeenCalledWith(expect.any(Error), { pageId: "p1" });
    });
  });
});

describe("factory (lazy client)", () => {
  let mockClient: ReturnType<typeof makeMockClient>;

  beforeEach(() => {
    mockClient = makeMockClient();
  });

  it("works with a sync factory function", async () => {
    const factory = vi.fn(() => mockClient as unknown as NormConfig["client"]);
    const norm = new NormClient({
      client: factory as unknown as NormConfig["client"],
      onWarn: vi.fn(),
      onError: vi.fn(),
    });

    mockClient.dataSources.query.mockResolvedValue({ results: [{ id: "p1" }] });
    const result = await norm.queryDatabase("ds_123");

    expect(result.results).toHaveLength(1);
    expect(factory).toHaveBeenCalledTimes(1);
  });

  it("works with an async factory function", async () => {
    const factory = vi.fn(
      () =>
        Promise.resolve(mockClient) as unknown as Promise<
          NormConfig["client"]
        >,
    );
    const norm = new NormClient({
      client: factory as unknown as NormConfig["client"],
      onWarn: vi.fn(),
      onError: vi.fn(),
    });

    mockClient.dataSources.query.mockResolvedValue({ results: [{ id: "p1" }] });
    const result = await norm.queryDatabase("ds_123");

    expect(result.results).toHaveLength(1);
    expect(factory).toHaveBeenCalledTimes(1);
  });

  it("calls the factory only once for concurrent calls", async () => {
    let resolveClient!: (c: ReturnType<typeof makeMockClient>) => void;
    const factory = vi.fn(
      () =>
        new Promise<ReturnType<typeof makeMockClient>>((resolve) => {
          resolveClient = resolve;
        }),
    );

    const norm = new NormClient({
      client: factory as unknown as NormConfig["client"],
      onWarn: vi.fn(),
      onError: vi.fn(),
    });

    // Fire two concurrent requests
    const promise1 = norm.queryDatabase("ds_123");
    const promise2 = norm.queryDatabase("ds_456");

    // Resolve the factory once
    resolveClient(mockClient);
    mockClient.dataSources.query.mockResolvedValue({ results: [] });

    await Promise.all([promise1, promise2]);

    expect(factory).toHaveBeenCalledTimes(1);
  });

  it("calls onError when the factory throws", async () => {
    const onError = vi.fn();
    const factory = () => Promise.reject(new Error("auth failed"));

    const norm = new NormClient({
      client: factory as unknown as NormConfig["client"],
      onWarn: vi.fn(),
      onError,
    });

    const result = await norm.queryDatabase("ds_123");

    expect(result.results).toEqual([]);
    expect(onError).toHaveBeenCalledWith(expect.any(Error), {
      dataSourceId: "ds_123",
    });
  });
});
