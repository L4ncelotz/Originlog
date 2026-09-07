import { describe, it, expect } from "vitest";
import {
  ClaudeHistoryEntrySchema,
  ClaudeSessionFileHeaderSchema,
  parseHistoryEntry,
} from "../../../../src/adapters/claude/schemas.js";

describe("ClaudeHistoryEntrySchema", () => {
  it("parses valid history entry with all fields", () => {
    const raw = {
      display: "which model in ur is the best",
      pastedContents: {},
      timestamp: 1779932407431,
      project: "C:\\WINDOWS\\System32",
      sessionId: "748d105f-b044-4884-9d4f-0343f1917d8a",
    };
    const result = ClaudeHistoryEntrySchema.safeParse(raw);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.display).toBe("which model in ur is the best");
      expect(result.data.sessionId).toBe(
        "748d105f-b044-4884-9d4f-0343f1917d8a",
      );
      expect(result.data.timestamp).toBe(1779932407431);
      expect(result.data.project).toBe("C:\\WINDOWS\\System32");
    }
  });

  it("parses minimal history entry with missing optional fields", () => {
    const raw = { display: "hello" };
    const result = ClaudeHistoryEntrySchema.safeParse(raw);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.display).toBe("hello");
      expect(result.data.sessionId).toBeUndefined();
      expect(result.data.project).toBeUndefined();
      expect(result.data.timestamp).toBeUndefined();
    }
  });

  it("preserves unknown fields via passthrough", () => {
    const raw = {
      display: "test",
      sessionId: "s1",
      unknownAnthropicField: "future-compat",
      nestedObject: { key: "val" },
    };
    const result = ClaudeHistoryEntrySchema.safeParse(raw);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(
        (result.data as Record<string, unknown>).unknownAnthropicField,
      ).toBe("future-compat");
    }
  });
});

describe("ClaudeSessionFileHeaderSchema", () => {
  it("validates session file header metadata", () => {
    const raw = {
      sessionId: "sess-abc",
      id: "evt-1",
      type: "user",
      timestamp: 1710000000,
      project: "/path/to/repo",
    };
    const result = ClaudeSessionFileHeaderSchema.safeParse(raw);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.sessionId).toBe("sess-abc");
    }
  });

  it("preserves unknown fields on session file headers", () => {
    const raw = {
      sessionId: "s1",
      customFlag: true,
    };
    const result = ClaudeSessionFileHeaderSchema.safeParse(raw);
    expect(result.success).toBe(true);
    if (result.success) {
      expect((result.data as Record<string, unknown>).customFlag).toBe(true);
    }
  });
});

describe("parseHistoryEntry", () => {
  it("parses valid JSON string", () => {
    const json = JSON.stringify({
      display: "Run tests",
      sessionId: "s-123",
      timestamp: 1710000000,
    });
    const entry = parseHistoryEntry(json);
    expect(entry).not.toBeNull();
    expect(entry?.display).toBe("Run tests");
    expect(entry?.sessionId).toBe("s-123");
  });

  it("parses object input directly", () => {
    const entry = parseHistoryEntry({ display: "Direct object", sessionId: "s-456" });
    expect(entry).not.toBeNull();
    expect(entry?.display).toBe("Direct object");
  });

  it("returns null for empty string or whitespace", () => {
    expect(parseHistoryEntry("")).toBeNull();
    expect(parseHistoryEntry("   \n\t  ")).toBeNull();
  });

  it("returns null for malformed JSON string", () => {
    expect(parseHistoryEntry("{not-json")).toBeNull();
  });

  it("returns null for non-object JSON values", () => {
    expect(parseHistoryEntry("12345")).toBeNull();
    expect(parseHistoryEntry('"just a string"')).toBeNull();
    expect(parseHistoryEntry("true")).toBeNull();
    expect(parseHistoryEntry("null")).toBeNull();
    expect(parseHistoryEntry("[]")).toBeNull();
    expect(parseHistoryEntry([1, 2, 3])).toBeNull();
  });
});
