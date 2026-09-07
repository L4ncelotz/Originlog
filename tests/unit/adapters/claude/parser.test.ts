import { describe, it, expect } from "vitest";
import { extractFileTouches } from "../../../../src/core/events.js";
import {
  parseClaudeSession,
  parseClaudeSessionSummary,
} from "../../../../src/adapters/claude/parser.js";
import { parseTranscriptLine } from "../../../../src/adapters/claude/schemas.js";

describe("parseTranscriptLine", () => {
  it("parses a valid user prompt line", () => {
    const raw = JSON.stringify({
      type: "user",
      sessionId: "session-123",
      uuid: "u-1",
      timestamp: "2026-07-24T04:19:53.790Z",
      cwd: "/repo",
      promptId: "p-1",
      message: {
        role: "user",
        content: "Fix the JWT authentication bug",
      },
    });

    const parsed = parseTranscriptLine(raw);
    expect(parsed).not.toBeNull();
    expect(parsed?.type).toBe("user");
    expect(parsed?.sessionId).toBe("session-123");
    expect(parsed?.uuid).toBe("u-1");
    expect(parsed?.promptId).toBe("p-1");
    expect(parsed?.cwd).toBe("/repo");
  });

  it("parses a valid assistant tool_use line", () => {
    const raw = JSON.stringify({
      type: "assistant",
      sessionId: "session-123",
      uuid: "u-2",
      timestamp: "2026-07-24T04:20:00.000Z",
      message: {
        role: "assistant",
        content: [
          {
            type: "tool_use",
            id: "toolu_read_1",
            name: "Read",
            input: { file_path: "src/auth.ts" },
          },
        ],
      },
    });

    const parsed = parseTranscriptLine(raw);
    expect(parsed).not.toBeNull();
    expect(parsed?.type).toBe("assistant");
    expect(Array.isArray(parsed?.message?.content)).toBe(true);
  });

  it("returns null for malformed JSON", () => {
    expect(parseTranscriptLine("not json at all {")).toBeNull();
  });

  it("returns null for empty or whitespace-only input", () => {
    expect(parseTranscriptLine("")).toBeNull();
    expect(parseTranscriptLine("   \n\t  ")).toBeNull();
  });

  it("returns null for non-object JSON values", () => {
    expect(parseTranscriptLine("12345")).toBeNull();
    expect(parseTranscriptLine('"a string"')).toBeNull();
    expect(parseTranscriptLine("[1, 2, 3]")).toBeNull();
    expect(parseTranscriptLine("null")).toBeNull();
  });

  it("preserves unknown extra fields via passthrough", () => {
    const raw = JSON.stringify({
      type: "user",
      uuid: "u-extra",
      futureAnthropicField: "future-value",
      nestedMeta: { enabled: true },
    });

    const parsed = parseTranscriptLine(raw);
    expect(parsed).not.toBeNull();
    expect((parsed as Record<string, unknown>).futureAnthropicField).toBe(
      "future-value",
    );
  });
});

describe("parseClaudeSession", () => {
  it("parses a normal multi-turn session with tools, commands, and results", () => {
    const lines = [
      JSON.stringify({
        type: "user",
        sessionId: "session-norm-1",
        uuid: "u-1",
        timestamp: "2026-07-24T10:00:00.000Z",
        cwd: "/project",
        promptId: "p-1",
        message: {
          role: "user",
          content: "Fix token refresh logic",
        },
      }),
      JSON.stringify({
        type: "assistant",
        sessionId: "session-norm-1",
        uuid: "u-2",
        timestamp: "2026-07-24T10:01:00.000Z",
        message: {
          role: "assistant",
          content: [
            {
              type: "tool_use",
              id: "toolu_read",
              name: "Read",
              input: { file_path: "/project/src/auth.ts", offset: 10, limit: 20 },
            },
          ],
        },
      }),
      JSON.stringify({
        type: "assistant",
        sessionId: "session-norm-1",
        uuid: "u-3",
        timestamp: "2026-07-24T10:02:00.000Z",
        message: {
          role: "assistant",
          content: [
            {
              type: "tool_use",
              id: "toolu_edit",
              name: "Edit",
              input: {
                file_path: "/project/src/auth.ts",
                old_string: "const v = 1;",
                new_string: "const v = 2;",
              },
            },
          ],
        },
      }),
      JSON.stringify({
        type: "assistant",
        sessionId: "session-norm-1",
        uuid: "u-4",
        timestamp: "2026-07-24T10:03:00.000Z",
        message: {
          role: "assistant",
          content: [
            {
              type: "tool_use",
              id: "toolu_bash",
              name: "Bash",
              input: { command: "npm test" },
            },
          ],
        },
      }),
      JSON.stringify({
        type: "user",
        sessionId: "session-norm-1",
        uuid: "u-5",
        timestamp: "2026-07-24T10:04:00.000Z",
        message: {
          role: "user",
          content: [
            {
              type: "tool_result",
              tool_use_id: "toolu_bash",
              content: "Tests passed: 5/5",
              is_error: false,
            },
          ],
        },
      }),
    ].join("\n");

    const session = parseClaudeSession(
      "session-fallback",
      lines,
      "/fake/path.jsonl",
      "/project",
    );

    expect(session.id).toBe("session-norm-1");
    expect(session.agent).toBe("claude");
    expect(session.projectPath).toBe("/project");
    expect(session.repoRoot).toBe("/project");
    expect(session.sourcePath).toBe("/fake/path.jsonl");
    expect(session.prompt).toBe("Fix token refresh logic");
    expect(session.title).toBe("Fix token refresh logic");
    expect(session.startedAt).toEqual(new Date("2026-07-24T10:00:00.000Z"));
    expect(session.endedAt).toEqual(new Date("2026-07-24T10:04:00.000Z"));

    expect(session.events).toHaveLength(5);

    const [evPrompt, evRead, evWrite, evTest, evResult] = session.events;
    expect(evPrompt?.type).toBe("prompt");
    expect(evPrompt?.content).toBe("Fix token refresh logic");

    expect(evRead?.type).toBe("read");
    expect(evRead?.file).toBe("src/auth.ts");
    expect(evRead?.range).toEqual({ startLine: 10, endLine: 29 });

    expect(evWrite?.type).toBe("write");
    expect(evWrite?.file).toBe("src/auth.ts");
    expect(evWrite?.content).toBe("const v = 2;");

    expect(evTest?.type).toBe("test");
    expect(evTest?.command).toBe("npm test");

    expect(evResult?.type).toBe("result");
    expect(evResult?.success).toBe(true);
    expect(evResult?.content).toBe("Tests passed: 5/5");
  });

  it("deduplicates entries by uuid across resumed session replays", () => {
    const lines = [
      JSON.stringify({
        type: "user",
        sessionId: "s-dedup",
        uuid: "u-same",
        timestamp: "2026-07-24T10:00:00.000Z",
        promptId: "p-1",
        message: { role: "user", content: "First prompt" },
      }),
      JSON.stringify({
        type: "user",
        sessionId: "s-dedup",
        uuid: "u-same", // replayed duplicate
        timestamp: "2026-07-24T10:00:00.000Z",
        promptId: "p-1",
        message: { role: "user", content: "First prompt" },
      }),
    ].join("\n");

    const session = parseClaudeSession("s-dedup", lines, "/path.jsonl");
    expect(session.events).toHaveLength(1);
  });

  it("preserves failed write attempts as evidence with success=false and metadata", () => {
    const lines = [
      JSON.stringify({
        type: "user",
        sessionId: "s-fail",
        uuid: "u-1",
        promptId: "p-1",
        message: { role: "user", content: "Try editing file" },
      }),
      JSON.stringify({
        type: "assistant",
        sessionId: "s-fail",
        uuid: "u-2",
        message: {
          role: "assistant",
          content: [
            {
              type: "tool_use",
              id: "toolu_failed_edit",
              name: "Edit",
              input: { file_path: "src/auth.ts", new_string: "bad code" },
            },
          ],
        },
      }),
      JSON.stringify({
        type: "user",
        sessionId: "s-fail",
        uuid: "u-3",
        message: {
          role: "user",
          content: [
            {
              type: "tool_result",
              tool_use_id: "toolu_failed_edit",
              content: "Permission denied",
              is_error: true,
            },
          ],
        },
      }),
    ].join("\n");

    const session = parseClaudeSession("s-fail", lines, "/path.jsonl");

    // The write event IS preserved as an attempted action with success=false
    const writeEvents = session.events.filter((e) => e.type === "write");
    expect(writeEvents).toHaveLength(1);
    expect(writeEvents[0]?.success).toBe(false);
    expect(writeEvents[0]?.file).toBe("src/auth.ts");
    expect(writeEvents[0]?.metadata).toMatchObject({
      attempted: true,
      failed: true,
      error: "Permission denied",
    });

    // Followed by the error tool_result event
    const errorEvents = session.events.filter((e) => e.type === "error");
    expect(errorEvents).toHaveLength(1);
    expect(errorEvents[0]?.success).toBe(false);
    expect(errorEvents[0]?.content).toBe("Permission denied");

    // But extractFileTouches does NOT count it as a successful file write!
    const touches = extractFileTouches(session.id, session.events);
    expect(touches).toHaveLength(1);
    expect(touches[0]?.file).toBe("src/auth.ts");
    expect(touches[0]?.written).toBe(false);
  });

  it("preserves failed Bash/test command attempts with success=false followed by error result", () => {
    const lines = [
      JSON.stringify({
        type: "assistant",
        sessionId: "s-fail-cmd",
        uuid: "u-1",
        message: {
          role: "assistant",
          content: [
            {
              type: "tool_use",
              id: "toolu_fail_test",
              name: "Bash",
              input: { command: "npm test" },
            },
          ],
        },
      }),
      JSON.stringify({
        type: "user",
        sessionId: "s-fail-cmd",
        uuid: "u-2",
        message: {
          role: "user",
          content: [
            {
              type: "tool_result",
              tool_use_id: "toolu_fail_test",
              content: "FAIL: 2 tests failed",
              is_error: true,
            },
          ],
        },
      }),
    ].join("\n");

    const session = parseClaudeSession("s-fail-cmd", lines, "/path.jsonl");
    expect(session.events).toHaveLength(2);

    const testEvent = session.events[0];
    expect(testEvent?.type).toBe("test");
    expect(testEvent?.command).toBe("npm test");
    expect(testEvent?.success).toBe(false);
    expect(testEvent?.metadata).toMatchObject({
      attempted: true,
      failed: true,
      error: "FAIL: 2 tests failed",
    });

    const errorResult = session.events[1];
    expect(errorResult?.type).toBe("error");
    expect(errorResult?.success).toBe(false);
    expect(errorResult?.content).toBe("FAIL: 2 tests failed");
  });

  it("handles missing timestamps without fabricating them", () => {
    const lines = [
      JSON.stringify({
        type: "user",
        sessionId: "s-no-ts",
        uuid: "u-1",
        promptId: "p-1",
        // timestamp omitted
        message: { role: "user", content: "Prompt without time" },
      }),
    ].join("\n");

    const session = parseClaudeSession("s-no-ts", lines, "/path.jsonl");
    expect(session.startedAt).toBeUndefined();
    expect(session.endedAt).toBeUndefined();
    expect(session.events[0]?.timestamp).toBeUndefined();
  });

  it("silently skips malformed lines mixed in with valid lines", () => {
    const lines = [
      "not json line at all",
      JSON.stringify({
        type: "user",
        sessionId: "s-mixed",
        uuid: "u-1",
        promptId: "p-1",
        message: { role: "user", content: "Valid prompt" },
      }),
      "{ incomplete json",
      "",
    ].join("\n");

    const session = parseClaudeSession("s-mixed", lines, "/path.jsonl");
    expect(session.events).toHaveLength(1);
    expect(session.prompt).toBe("Valid prompt");
  });

  it("parses partial/truncated sessions cleanly", () => {
    const lines = JSON.stringify({
      type: "user",
      sessionId: "s-partial",
      uuid: "u-1",
      promptId: "p-1",
      message: { role: "user", content: "Lone user request" },
    });

    const session = parseClaudeSession("s-partial", lines, "/path.jsonl");
    expect(session.id).toBe("s-partial");
    expect(session.events).toHaveLength(1);
    expect(session.prompt).toBe("Lone user request");
  });

  it("handles MultiEdit tool calls by combining edits", () => {
    const lines = [
      JSON.stringify({
        type: "assistant",
        sessionId: "s-multi",
        uuid: "u-1",
        message: {
          role: "assistant",
          content: [
            {
              type: "tool_use",
              id: "toolu_multi",
              name: "MultiEdit",
              input: {
                file_path: "src/code.ts",
                edits: [
                  { old_string: "a", new_string: "change1" },
                  { old_string: "b", new_string: "change2" },
                ],
              },
            },
          ],
        },
      }),
    ].join("\n");

    const session = parseClaudeSession("s-multi", lines, "/path.jsonl");
    expect(session.events).toHaveLength(1);
    expect(session.events[0]?.type).toBe("write");
    expect(session.events[0]?.file).toBe("src/code.ts");
    expect(session.events[0]?.content).toBe("change1\nchange2");
  });

  it("handles unknown tool names by emitting type: unknown with metadata", () => {
    const lines = [
      JSON.stringify({
        type: "assistant",
        sessionId: "s-unk",
        uuid: "u-1",
        message: {
          role: "assistant",
          content: [
            {
              type: "tool_use",
              id: "toolu_future",
              name: "FutureAutonomousTool",
              input: { query: "solve problem", iterations: 5 },
            },
          ],
        },
      }),
    ].join("\n");

    const session = parseClaudeSession("s-unk", lines, "/path.jsonl");
    expect(session.events).toHaveLength(1);
    expect(session.events[0]?.type).toBe("unknown");
    expect(session.events[0]?.metadata?.tool).toBe("FutureAutonomousTool");
  });

  it("detects various test command patterns in Bash", () => {
    const commands = [
      { cmd: "npm test", expectedType: "test" },
      { cmd: "npx vitest run", expectedType: "test" },
      { cmd: "pytest -v", expectedType: "test" },
      { cmd: "cargo test --all", expectedType: "test" },
      { cmd: "ls -la", expectedType: "command" },
      { cmd: "git status", expectedType: "command" },
    ];

    for (const { cmd, expectedType } of commands) {
      const line = JSON.stringify({
        type: "assistant",
        sessionId: "s-cmd",
        uuid: `u-${cmd}`,
        message: {
          role: "assistant",
          content: [
            {
              type: "tool_use",
              id: `toolu_${cmd}`,
              name: "Bash",
              input: { command: cmd },
            },
          ],
        },
      });

      const session = parseClaudeSession("s-cmd", line, "/path.jsonl");
      expect(session.events[0]?.type).toBe(expectedType);
      expect(session.events[0]?.command).toBe(cmd);
    }
  });

  it("skips sidechain, meta, and compact summary lines for initial prompt", () => {
    const lines = [
      JSON.stringify({
        type: "user",
        sessionId: "s-meta",
        uuid: "u-1",
        promptId: "p-meta",
        isMeta: true,
        message: { role: "user", content: "System instructions" },
      }),
      JSON.stringify({
        type: "user",
        sessionId: "s-meta",
        uuid: "u-2",
        promptId: "p-side",
        isSidechain: true,
        message: { role: "user", content: "Background subagent prompt" },
      }),
      JSON.stringify({
        type: "user",
        sessionId: "s-meta",
        uuid: "u-3",
        promptId: "p-compact",
        isCompactSummary: true,
        message: { role: "user", content: "Summary of earlier session" },
      }),
      JSON.stringify({
        type: "user",
        sessionId: "s-meta",
        uuid: "u-4",
        promptId: "p-real",
        message: { role: "user", content: "Real human task" },
      }),
    ].join("\n");

    const session = parseClaudeSession("s-meta", lines, "/path.jsonl");
    expect(session.prompt).toBe("Real human task");
  });

  it("normalizes Windows paths cross-platform", () => {
    const lines = [
      JSON.stringify({
        type: "assistant",
        sessionId: "s-win",
        uuid: "u-1",
        message: {
          role: "assistant",
          content: [
            {
              type: "tool_use",
              id: "toolu_win",
              name: "Edit",
              input: {
                file_path: "C:\\Users\\dev\\repo\\src\\service.ts",
                new_string: "code",
              },
            },
          ],
        },
      }),
    ].join("\n");

    const session = parseClaudeSession(
      "s-win",
      lines,
      "/path.jsonl",
      "C:/Users/dev/repo",
    );
    expect(session.events[0]?.file).toBe("src/service.ts");
  });
  it("resolves canonical sessionId upfront so every event matches the session ID", () => {
    const lines = [
      JSON.stringify({
        type: "user",
        uuid: "u-1",
        promptId: "p-1",
        message: { role: "user", content: "First prompt" },
      }),
      JSON.stringify({
        type: "assistant",
        uuid: "u-2",
        message: {
          role: "assistant",
          content: [
            {
              type: "tool_use",
              id: "toolu_read",
              name: "Read",
              input: { file_path: "src/auth.ts" },
            },
          ],
        },
      }),
      JSON.stringify({
        type: "user",
        sessionId: "canonical-session-uuid-999",
        uuid: "u-3",
        promptId: "p-2",
        message: { role: "user", content: "Second prompt" },
      }),
    ].join("\n");

    const session = parseClaudeSession("fallback-sid", lines, "/path.jsonl");
    expect(session.id).toBe("canonical-session-uuid-999");
    expect(session.events).toHaveLength(3);
    for (const ev of session.events) {
      expect(ev.sessionId).toBe("canonical-session-uuid-999");
      expect(ev.sessionId).toBe(session.id);
    }
  });

  it("validates Read line ranges as valid 1-based data and rejects invalid numbers", () => {
    const testCases = [
      { offset: 1, limit: 10, expected: { startLine: 1, endLine: 10 } },
      { offset: 10, limit: 15, expected: { startLine: 10, endLine: 24 } },
      { offset: 0, limit: 10, expected: undefined },
      { offset: -5, limit: 10, expected: undefined },
      { offset: 10, limit: 0, expected: undefined },
      { offset: 10, limit: -2, expected: undefined },
      { offset: 1.5, limit: 10, expected: undefined },
      { offset: 10, limit: 2.5, expected: undefined },
      { offset: Number.NaN, limit: 10, expected: undefined },
    ];

    for (const tc of testCases) {
      const line = JSON.stringify({
        type: "assistant",
        sessionId: "s-range",
        uuid: `u-range-${tc.offset}-${tc.limit}`,
        message: {
          role: "assistant",
          content: [
            {
              type: "tool_use",
              id: `toolu_${tc.offset}_${tc.limit}`,
              name: "Read",
              input: { file_path: "src/a.ts", offset: tc.offset, limit: tc.limit },
            },
          ],
        },
      });

      const session = parseClaudeSession("s-range", line, "/path.jsonl");
      expect(session.events[0]?.range).toEqual(tc.expected);
    }
  });

  it("validates view_range as valid 1-based data", () => {
    const validLine = JSON.stringify({
      type: "assistant",
      sessionId: "s-vr",
      uuid: "u-vr-1",
      message: {
        role: "assistant",
        content: [
          {
            type: "tool_use",
            id: "toolu_vr_1",
            name: "Read",
            input: { file_path: "src/a.ts", view_range: [5, 25] },
          },
        ],
      },
    });
    expect(parseClaudeSession("s-vr", validLine, "/path.jsonl").events[0]?.range).toEqual({
      startLine: 5,
      endLine: 25,
    });

    const invalidLine = JSON.stringify({
      type: "assistant",
      sessionId: "s-vr",
      uuid: "u-vr-2",
      message: {
        role: "assistant",
        content: [
          {
            type: "tool_use",
            id: "toolu_vr_2",
            name: "Read",
            input: { file_path: "src/a.ts", view_range: [25, 5] },
          },
        ],
      },
    });
    expect(parseClaudeSession("s-vr", invalidLine, "/path.jsonl").events[0]?.range).toBeUndefined();
  });
});

describe("parseClaudeSessionSummary", () => {
  it("extracts summary metadata from header lines without parsing entire session", () => {
    const headerLines = [
      JSON.stringify({
        type: "user",
        sessionId: "summary-session-1",
        timestamp: "2026-07-24T10:00:00.000Z",
        cwd: "/my/project",
        promptId: "p-1",
        message: {
          role: "user",
          content: "A very important prompt\nwith multiple lines of description",
        },
      }),
      JSON.stringify({
        type: "assistant",
        sessionId: "summary-session-1",
        timestamp: "2026-07-24T10:05:00.000Z",
        message: {
          role: "assistant",
          content: [
            {
              type: "tool_use",
              id: "toolu_1",
              name: "Read",
              input: { file_path: "src/a.ts" },
            },
          ],
        },
      }),
    ].join("\n");

    const summary = parseClaudeSessionSummary(
      "summary-session-1.jsonl",
      headerLines,
    );

    expect(summary).not.toBeNull();
    expect(summary?.id).toBe("summary-session-1");
    expect(summary?.agent).toBe("claude");
    expect(summary?.projectPath).toBe("/my/project");
    expect(summary?.promptPreview).toBe("A very important prompt");
    expect(summary?.startedAt).toEqual(new Date("2026-07-24T10:00:00.000Z"));
    expect(summary?.endedAt).toEqual(new Date("2026-07-24T10:05:00.000Z"));
    expect(summary?.eventCount).toBe(2);
  });

  it("falls back to file basename if sessionId is missing in header", () => {
    const headerLines = JSON.stringify({
      type: "user",
      timestamp: "2026-07-24T10:00:00.000Z",
      message: { role: "user", content: "Prompt" },
    });

    const summary = parseClaudeSessionSummary(
      "fallback-id.jsonl",
      headerLines,
    );

    expect(summary?.id).toBe("fallback-id");
  });

  it("returns null if header is completely empty", () => {
    expect(parseClaudeSessionSummary("", "")).toBeNull();
  });
  it("computes accurate endedAt and eventCount across the entire session file", () => {
    const lines: string[] = [
      JSON.stringify({
        type: "user",
        sessionId: "large-session",
        uuid: "u-0",
        timestamp: "2026-07-24T10:00:00.000Z",
        promptId: "p-start",
        message: { role: "user", content: "Start big session" },
      }),
    ];

    for (let i = 1; i <= 70; i++) {
      lines.push(
        JSON.stringify({
          type: "assistant",
          sessionId: "large-session",
          uuid: `u-${i}`,
          timestamp: new Date(new Date("2026-07-24T10:00:00.000Z").getTime() + i * 60000).toISOString(),
          message: {
            role: "assistant",
            content: [
              {
                type: "tool_use",
                id: `toolu_${i}`,
                name: "Read",
                input: { file_path: `src/file_${i % 5}.ts` },
              },
            ],
          },
        }),
      );
    }

    const summary = parseClaudeSessionSummary(
      "large-session.jsonl",
      lines.join("\n"),
    );

    expect(summary).not.toBeNull();
    expect(summary?.id).toBe("large-session");
    expect(summary?.startedAt).toEqual(new Date("2026-07-24T10:00:00.000Z"));
    expect(summary?.endedAt).toEqual(new Date("2026-07-24T11:10:00.000Z"));
    expect(summary?.eventCount).toBe(71);
    expect(summary?.touchedFileCount).toBe(5);
  });
});
