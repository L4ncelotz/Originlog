import { describe, it, expect } from "vitest";
import {
  formatLineRange,
  truncateOneLine,
  getEventLabel,
  getEventDetails,
  formatTimelineEvent,
  renderSessionTimeline,
} from "../../../src/ui/timeline.js";
import type { NormalizedEvent } from "../../../src/core/events.js";
import type { NormalizedSession } from "../../../src/core/sessions.js";

describe("formatLineRange", () => {
  it("returns empty string when range is undefined", () => {
    expect(formatLineRange(undefined)).toBe("");
  });

  it("formats single line range as :L<line>", () => {
    expect(formatLineRange({ startLine: 42, endLine: 42 })).toBe(":L42");
  });

  it("formats multi-line range as :L<start>-<end>", () => {
    expect(formatLineRange({ startLine: 10, endLine: 25 })).toBe(":L10-25");
  });
});

describe("truncateOneLine", () => {
  it("returns empty string for empty input", () => {
    expect(truncateOneLine("")).toBe("");
  });

  it("flattens multi-line strings into a single line", () => {
    expect(truncateOneLine("Line 1\nLine 2\r\nLine 3")).toBe("Line 1 Line 2 Line 3");
  });

  it("truncates long strings with ellipsis", () => {
    const long = "a".repeat(100);
    const res = truncateOneLine(long, 20);
    expect(res).toHaveLength(20);
    expect(res.endsWith("...")).toBe(true);
  });
});

describe("getEventLabel", () => {
  it("maps core event types to stable labels", () => {
    expect(getEventLabel({ id: "1", sessionId: "s", type: "prompt" })).toBe("PROMPT");
    expect(getEventLabel({ id: "2", sessionId: "s", type: "read" })).toBe("READ");
    expect(getEventLabel({ id: "3", sessionId: "s", type: "write" })).toBe("EDIT");
    expect(getEventLabel({ id: "4", sessionId: "s", type: "command" })).toBe("RUN");
    expect(getEventLabel({ id: "5", sessionId: "s", type: "result" })).toBe("RESULT");
    expect(getEventLabel({ id: "6", sessionId: "s", type: "error" })).toBe("ERROR");
    expect(getEventLabel({ id: "7", sessionId: "s", type: "unknown" })).toBe("EVENT");
  });

  it("maps test success to PASS and test failure to FAIL", () => {
    expect(getEventLabel({ id: "1", sessionId: "s", type: "test", success: true })).toBe("PASS");
    expect(getEventLabel({ id: "2", sessionId: "s", type: "test", success: false })).toBe("FAIL");
    expect(getEventLabel({ id: "3", sessionId: "s", type: "test" })).toBe("TEST");
  });
});

describe("getEventDetails", () => {
  it("includes line range in read and write events", () => {
    const readEv: NormalizedEvent = {
      id: "1",
      sessionId: "s",
      type: "read",
      file: "src/auth.ts",
      range: { startLine: 1, endLine: 30 },
    };
    expect(getEventDetails(readEv)).toBe("src/auth.ts:L1-30");

    const writeEv: NormalizedEvent = {
      id: "2",
      sessionId: "s",
      type: "write",
      file: "src/auth.ts",
      range: { startLine: 5, endLine: 5 },
    };
    expect(getEventDetails(writeEv)).toBe("src/auth.ts:L5");
  });

  it("appends (failed) for failed writes or commands", () => {
    const failedWrite: NormalizedEvent = {
      id: "1",
      sessionId: "s",
      type: "write",
      file: "src/auth.ts",
      success: false,
    };
    expect(getEventDetails(failedWrite)).toBe("src/auth.ts (failed)");

    const failedCmd: NormalizedEvent = {
      id: "2",
      sessionId: "s",
      type: "command",
      command: "npm test",
      success: false,
    };
    expect(getEventDetails(failedCmd)).toBe("npm test (failed)");
  });
});

describe("formatTimelineEvent", () => {
  it("formats a complete event row without color", () => {
    const event: NormalizedEvent = {
      id: "e1",
      sessionId: "s1",
      type: "prompt",
      content: "Implement token validation",
      timestamp: new Date("2026-09-07T14:21:05.000Z"),
    };

    const row = formatTimelineEvent(event, { color: false, utc: true });
    expect(row).toBe("14:21:05  PROMPT   Implement token validation");
  });

  it("renders 8 spaces when timestamp is missing", () => {
    const event: NormalizedEvent = {
      id: "e1",
      sessionId: "s1",
      type: "command",
      command: "git status",
    };

    const row = formatTimelineEvent(event, { color: false });
    expect(row).toBe("          RUN      git status");
  });
});

describe("renderSessionTimeline", () => {
  it("renders header and events in encounter order", () => {
    const session: NormalizedSession = {
      id: "sess-timeline-1",
      agent: "Claude Code",
      projectPath: "/home/user/project",
      startedAt: new Date("2026-09-07T14:20:00.000Z"),
      prompt: "Refactor auth tokens",
      events: [
        {
          id: "e1",
          sessionId: "sess-timeline-1",
          type: "prompt",
          content: "Refactor auth tokens",
          timestamp: new Date("2026-09-07T14:20:01.000Z"),
        },
        {
          id: "e2",
          sessionId: "sess-timeline-1",
          type: "read",
          file: "src/auth.ts",
          range: { startLine: 1, endLine: 20 },
          timestamp: new Date("2026-09-07T14:20:05.000Z"),
        },
        {
          id: "e3",
          sessionId: "sess-timeline-1",
          type: "write",
          file: "src/auth.ts",
          range: { startLine: 15, endLine: 18 },
          timestamp: new Date("2026-09-07T14:20:10.000Z"),
        },
        {
          id: "e4",
          sessionId: "sess-timeline-1",
          type: "command",
          command: "npm test",
          success: true,
          timestamp: new Date("2026-09-07T14:20:15.000Z"),
        },
        {
          id: "e5",
          sessionId: "sess-timeline-1",
          type: "test",
          command: "npm test",
          success: true,
          timestamp: new Date("2026-09-07T14:20:20.000Z"),
        },
        {
          id: "e6",
          sessionId: "sess-timeline-1",
          type: "result",
          content: "Tests passed: 10/10",
          timestamp: new Date("2026-09-07T14:20:22.000Z"),
        },
        {
          id: "e7",
          sessionId: "sess-timeline-1",
          type: "unknown",
          content: "verbose internal log",
        },
      ],
    };

    const output = renderSessionTimeline(session, { color: false, utc: true });

    expect(output).toContain("Session:  sess-timeline-1");
    expect(output).toContain("Agent:    Claude Code");
    expect(output).toContain("Started:  2026-09-07 14:20:00");
    expect(output).toContain("Project:  /home/user/project");
    expect(output).toContain("Prompt:   Refactor auth tokens");
    expect(output).toContain("Events:   7");

    expect(output).toContain("14:20:01  PROMPT   Refactor auth tokens");
    expect(output).toContain("14:20:05  READ     src/auth.ts:L1-20");
    expect(output).toContain("14:20:10  EDIT     src/auth.ts:L15-18");
    expect(output).toContain("14:20:15  RUN      npm test");
    expect(output).toContain("14:20:20  PASS     npm test");
    expect(output).toContain("14:20:22  RESULT   Tests passed: 10/10");

    // "unknown" event should be hidden by default
    expect(output).not.toContain("verbose internal log");
  });

  it("shows unknown events when verbose=true", () => {
    const session: NormalizedSession = {
      id: "sess-verbose",
      agent: "Claude Code",
      events: [
        {
          id: "e1",
          sessionId: "sess-verbose",
          type: "unknown",
          content: "internal telemetry payload",
        },
      ],
    };

    const nonVerbose = renderSessionTimeline(session, { color: false, verbose: false });
    expect(nonVerbose).toContain("(No recorded events in this session)");

    const verbose = renderSessionTimeline(session, { color: false, verbose: true });
    expect(verbose).toContain("EVENT    internal telemetry payload");
  });

  it("renders clean fallback for empty session", () => {
    const session: NormalizedSession = {
      id: "empty-session",
      agent: "Claude Code",
      events: [],
    };

    const output = renderSessionTimeline(session, { color: false });
    expect(output).toContain("(No recorded events in this session)");
  });
});
