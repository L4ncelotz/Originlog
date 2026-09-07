import { describe, it, expect } from "vitest";
import {
  sortEvents,
  extractFileTouches,
  createNormalizedEvent,
  type NormalizedEvent,
} from "../../src/core/events.js";

const event = (
  id: string,
  sessionId: string,
  type: NormalizedEvent["type"],
  partial: Partial<NormalizedEvent> = {},
): NormalizedEvent => ({
  id,
  sessionId,
  type,
  ...partial,
});

describe("createNormalizedEvent", () => {
  it("preserves undefined timestamp when none is provided (never fabricates dates)", () => {
    const created = createNormalizedEvent({
      id: "e1",
      sessionId: "s1",
      type: "prompt",
    });

    expect(created.id).toBe("e1");
    expect(created.sessionId).toBe("s1");
    expect(created.type).toBe("prompt");
    expect(created.timestamp).toBeUndefined();
  });

  it("preserves explicitly provided timestamp and optional values", () => {
    const ts = new Date(100);
    const created = createNormalizedEvent({
      id: "e1",
      sessionId: "s1",
      type: "read",
      timestamp: ts,
      file: "src/auth.ts",
      command: undefined,
      success: true,
      range: { startLine: 10, endLine: 20 },
      metadata: { foo: "bar" },
    });
    expect(created.timestamp).toBe(ts);
    expect(created.file).toBe("src/auth.ts");
    expect(created.command).toBeUndefined();
    expect(created.success).toBe(true);
    expect(created.range).toEqual({ startLine: 10, endLine: 20 });
    expect(created.metadata).toEqual({ foo: "bar" });
  });
});

describe("sortEvents", () => {
  it("returns an empty array for an empty input", () => {
    expect(sortEvents([])).toEqual([]);
  });

  it("returns a single event unchanged", () => {
    const single = [event("a", "s1", "prompt", { timestamp: new Date(5) })];
    const sorted = sortEvents(single);
    expect(sorted).toHaveLength(1);
    expect(sorted[0]!.id).toBe("a");
  });

  it("sorts out-of-order events chronologically ascending", () => {
    const events = [
      event("c", "s1", "read", { timestamp: new Date(30) }),
      event("a", "s1", "prompt", { timestamp: new Date(10) }),
      event("b", "s1", "read", { timestamp: new Date(20) }),
    ];
    const sorted = sortEvents(events);
    expect(sorted.map((e) => e.id)).toEqual(["a", "b", "c"]);
  });

  it("preserves order for already-sorted events", () => {
    const events = [
      event("a", "s1", "prompt", { timestamp: new Date(10) }),
      event("b", "s1", "read", { timestamp: new Date(20) }),
      event("c", "s1", "write", { timestamp: new Date(30) }),
    ];
    expect(sortEvents(events).map((e) => e.id)).toEqual(["a", "b", "c"]);
  });

  it("breaks equal timestamps deterministically by id", () => {
    const ts = new Date(100);
    const events = [
      event("c", "s1", "read", { timestamp: ts }),
      event("a", "s1", "read", { timestamp: ts }),
      event("b", "s1", "read", { timestamp: ts }),
    ];
    const sorted = sortEvents(events);
    expect(sorted.map((e) => e.id)).toEqual(["a", "b", "c"]);
  });

  it("does not mutate the input array", () => {
    const events = [
      event("b", "s1", "read", { timestamp: new Date(20) }),
      event("a", "s1", "read", { timestamp: new Date(10) }),
    ];
    const before = events.map((e) => e.id);
    sortEvents(events);
    const after = events.map((e) => e.id);
    expect(after).toEqual(before);
  });

  it("places events with unknown timestamps after known events, ordered by id", () => {
    const events = [
      event("unknown-b", "s1", "read"),
      event("known-2", "s1", "read", { timestamp: new Date(50) }),
      event("unknown-a", "s1", "read"),
      event("known-1", "s1", "read", { timestamp: new Date(10) }),
    ];
    const sorted = sortEvents(events);
    expect(sorted.map((e) => e.id)).toEqual([
      "known-1",
      "known-2",
      "unknown-a",
      "unknown-b",
    ]);
  });

  it("handles invalid dates as unknown timestamps", () => {
    const events = [
      event("valid", "s1", "read", { timestamp: new Date(10) }),
      event("invalid", "s1", "read", { timestamp: new Date(NaN) }),
    ];
    const sorted = sortEvents(events);
    expect(sorted.map((e) => e.id)).toEqual(["valid", "invalid"]);
  });
});

describe("extractFileTouches", () => {
  it("returns an empty array when no events have a file", () => {
    const events = [
      event("a", "s1", "prompt", { timestamp: new Date(10) }),
      event("b", "s1", "command", {
        command: "ls",
        timestamp: new Date(20),
      }),
    ];
    expect(extractFileTouches("s1", events)).toEqual([]);
  });

  it("builds a touch with read=true for read events", () => {
    const events = [
      event("a", "s1", "read", {
        file: "src/auth.ts",
        timestamp: new Date(10),
      }),
    ];
    const [touch] = extractFileTouches("s1", events);
    expect(touch!.file).toBe("src/auth.ts");
    expect(touch!.read).toBe(true);
    expect(touch!.written).toBe(false);
    expect(touch!.sessionId).toBe("s1");
    expect(touch!.firstTouchedAt?.getTime()).toBe(10);
    expect(touch!.lastTouchedAt?.getTime()).toBe(10);
  });

  it("builds a touch with written=true for write events", () => {
    const events = [
      event("a", "s1", "write", {
        file: "src/auth.ts",
        timestamp: new Date(20),
      }),
    ];
    const [touch] = extractFileTouches("s1", events);
    expect(touch!.written).toBe(true);
    expect(touch!.read).toBe(false);
  });

  it("combines read and write into a single touch with both flags true", () => {
    const events = [
      event("a", "s1", "read", {
        file: "src/auth.ts",
        timestamp: new Date(10),
      }),
      event("b", "s1", "write", {
        file: "src/auth.ts",
        timestamp: new Date(30),
      }),
    ];
    const [touch] = extractFileTouches("s1", events);
    expect(touch!.read).toBe(true);
    expect(touch!.written).toBe(true);
    expect(touch!.firstTouchedAt?.getTime()).toBe(10);
    expect(touch!.lastTouchedAt?.getTime()).toBe(30);
  });

  it("preserves undefined firstTouchedAt and lastTouchedAt when events lack timestamps", () => {
    const events = [
      event("a", "s1", "read", { file: "src/auth.ts" }),
      event("b", "s1", "write", { file: "src/auth.ts" }),
    ];
    const [touch] = extractFileTouches("s1", events);
    expect(touch!.firstTouchedAt).toBeUndefined();
    expect(touch!.lastTouchedAt).toBeUndefined();
    expect(touch!.read).toBe(true);
    expect(touch!.written).toBe(true);
  });

  it("accumulates line ranges in encounter order", () => {
    const events = [
      event("a", "s1", "read", {
        file: "src/auth.ts",
        timestamp: new Date(10),
        range: { startLine: 1, endLine: 5 },
      }),
      event("b", "s1", "write", {
        file: "src/auth.ts",
        timestamp: new Date(20),
        range: { startLine: 10, endLine: 15 },
      }),
    ];
    const [touch] = extractFileTouches("s1", events);
    expect(touch!.ranges).toEqual([
      { startLine: 1, endLine: 5 },
      { startLine: 10, endLine: 15 },
    ]);
  });

  it("returns files sorted alphabetically", () => {
    const events = [
      event("a", "s1", "read", {
        file: "src/zeta.ts",
        timestamp: new Date(10),
      }),
      event("b", "s1", "read", {
        file: "src/alpha.ts",
        timestamp: new Date(20),
      }),
      event("c", "s1", "read", {
        file: "src/middle.ts",
        timestamp: new Date(30),
      }),
    ];
    const touches = extractFileTouches("s1", events);
    expect(touches.map((t) => t.file)).toEqual([
      "src/alpha.ts",
      "src/middle.ts",
      "src/zeta.ts",
    ]);
  });
});
