import { describe, it, expect } from "vitest";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { claudeAdapter } from "../../../../src/adapters/claude/adapter.js";
import { extractFileTouches } from "../../../../src/core/events.js";
import { summarizeSession } from "../../../../src/core/sessions.js";
import type { AdapterContext } from "../../../../src/adapters/types.js";

async function withTempContext(
  callback: (context: AdapterContext, tempRoot: string) => Promise<void>,
): Promise<void> {
  const tempRoot = await fs.mkdtemp(
    path.join(os.tmpdir(), "originlog-transcript-val-"),
  );
  const homeDir = path.join(tempRoot, "home");
  const repoRoot = path.join(tempRoot, "repo");
  const cwd = repoRoot;

  await fs.mkdir(homeDir, { recursive: true });
  await fs.mkdir(repoRoot, { recursive: true });

  const context: AdapterContext = { cwd, repoRoot, homeDir };

  try {
    await callback(context, tempRoot);
  } finally {
    await fs.rm(tempRoot, { recursive: true, force: true });
  }
}

describe("Claude Code realistic transcript validation", () => {
  it("validates realistic transcripts with failed attempts, successful edits, and research sessions", async () => {
    await withTempContext(async (context) => {
      const projectsDir = path.join(context.homeDir, ".claude", "projects", "api-project");
      await fs.mkdir(projectsDir, { recursive: true });

      // Transcript 1: Session with failed write and failed test command
      const t1 = [
        JSON.stringify({
          type: "user",
          sessionId: "transcript-1-fail",
          uuid: "u-1",
          promptId: "p-1",
          timestamp: "2026-07-24T10:00:00.000Z",
          cwd: context.cwd,
          message: {
            role: "user",
            content: "Fix the authentication token race condition",
          },
        }),
        JSON.stringify({
          type: "assistant",
          sessionId: "transcript-1-fail",
          uuid: "u-2",
          timestamp: "2026-07-24T10:01:00.000Z",
          cwd: context.cwd,
          message: {
            role: "assistant",
            content: [
              {
                type: "tool_use",
                id: "t_read_1",
                name: "Read",
                input: { file_path: "src/auth.ts", offset: 1, limit: 50 },
              },
            ],
          },
        }),
        JSON.stringify({
          type: "assistant",
          sessionId: "transcript-1-fail",
          uuid: "u-3",
          timestamp: "2026-07-24T10:02:00.000Z",
          cwd: context.cwd,
          message: {
            role: "assistant",
            content: [
              {
                type: "tool_use",
                id: "t_edit_1",
                name: "Edit",
                input: {
                  file_path: "src/auth.ts",
                  new_string: "invalid code",
                },
              },
            ],
          },
        }),
        JSON.stringify({
          type: "user",
          sessionId: "transcript-1-fail",
          uuid: "u-4",
          timestamp: "2026-07-24T10:02:30.000Z",
          cwd: context.cwd,
          message: {
            role: "user",
            content: [
              {
                type: "tool_result",
                tool_use_id: "t_edit_1",
                content: "Permission denied: read-only filesystem",
                is_error: true,
              },
            ],
          },
        }),
        JSON.stringify({
          type: "assistant",
          sessionId: "transcript-1-fail",
          uuid: "u-5",
          timestamp: "2026-07-24T10:03:00.000Z",
          cwd: context.cwd,
          message: {
            role: "assistant",
            content: [
              {
                type: "tool_use",
                id: "t_test_1",
                name: "Bash",
                input: { command: "npm test" },
              },
            ],
          },
        }),
        JSON.stringify({
          type: "user",
          sessionId: "transcript-1-fail",
          uuid: "u-6",
          timestamp: "2026-07-24T10:03:45.000Z",
          cwd: context.cwd,
          message: {
            role: "user",
            content: [
              {
                type: "tool_result",
                tool_use_id: "t_test_1",
                content: "FAIL: 1 test failed",
                is_error: true,
              },
            ],
          },
        }),
      ].join("\n");

      // Transcript 2: Multi-turn successful session with edits
      const t2 = [
        JSON.stringify({
          type: "user",
          sessionId: "transcript-2-success",
          uuid: "u-20",
          promptId: "p-20",
          timestamp: "2026-07-25T12:00:00.000Z",
          cwd: context.cwd,
          message: {
            role: "user",
            content: "Refactor database migration scripts",
          },
        }),
        JSON.stringify({
          type: "assistant",
          sessionId: "transcript-2-success",
          uuid: "u-21",
          timestamp: "2026-07-25T12:05:00.000Z",
          cwd: context.cwd,
          message: {
            role: "assistant",
            content: [
              {
                type: "tool_use",
                id: "t_read_2",
                name: "Read",
                input: { file_path: "src/db.ts" },
              },
              {
                type: "tool_use",
                id: "t_write_2",
                name: "Write",
                input: {
                  file_path: "src/db.ts",
                  content: "export const db = 1;",
                },
              },
            ],
          },
        }),
        JSON.stringify({
          type: "user",
          sessionId: "transcript-2-success",
          uuid: "u-22",
          timestamp: "2026-07-25T12:05:30.000Z",
          cwd: context.cwd,
          message: {
            role: "user",
            content: [
              {
                type: "tool_result",
                tool_use_id: "t_read_2",
                content: "ok",
                is_error: false,
              },
              {
                type: "tool_result",
                tool_use_id: "t_write_2",
                content: "written",
                is_error: false,
              },
            ],
          },
        }),
      ].join("\n");

      // Transcript 3: Research session (web tools, no files touched)
      const t3 = [
        JSON.stringify({
          type: "user",
          sessionId: "transcript-3-research",
          uuid: "u-30",
          promptId: "p-30",
          timestamp: "2026-07-26T08:00:00.000Z",
          cwd: context.cwd,
          message: {
            role: "user",
            content: "Research upcoming Anthropic API changes",
          },
        }),
        JSON.stringify({
          type: "assistant",
          sessionId: "transcript-3-research",
          uuid: "u-31",
          timestamp: "2026-07-26T08:02:00.000Z",
          cwd: context.cwd,
          message: {
            role: "assistant",
            content: [
              {
                type: "tool_use",
                id: "t_web_1",
                name: "WebSearch",
                input: { query: "Anthropic changelog 2026" },
              },
            ],
          },
        }),
      ].join("\n");

      // Write all 3 transcripts
      await fs.writeFile(
        path.join(projectsDir, "transcript-1-fail.jsonl"),
        t1,
        "utf8",
      );
      await fs.writeFile(
        path.join(projectsDir, "transcript-2-success.jsonl"),
        t2,
        "utf8",
      );
      await fs.writeFile(
        path.join(projectsDir, "transcript-3-research.jsonl"),
        t3,
        "utf8",
      );

      // Write history.jsonl directly under ~/.claude/ to confirm exclusion
      await fs.writeFile(
        path.join(context.homeDir, ".claude", "history.jsonl"),
        JSON.stringify({ display: "ignored", sessionId: "s-hist" }) + "\n",
        "utf8",
      );

      // 1. Validate listSessions returns exactly 3 sessions (excluding history.jsonl)
      const list = await claudeAdapter.listSessions(context);
      expect(list).toHaveLength(3);
      expect(list.map((s) => s.id)).toEqual([
        "transcript-3-research",
        "transcript-2-success",
        "transcript-1-fail",
      ]);

      // 2. Validate Transcript 1: failed attempts preserved as evidence
      const s1 = await claudeAdapter.loadSession(
        "transcript-1-fail",
        context,
      );
      const writeEvent = s1.events.find((e) => e.type === "write");
      expect(writeEvent).toBeDefined();
      expect(writeEvent?.success).toBe(false);
      expect(writeEvent?.file).toBe("src/auth.ts");
      expect(writeEvent?.metadata).toMatchObject({
        attempted: true,
        failed: true,
        error: "Permission denied: read-only filesystem",
      });

      const testEvent = s1.events.find((e) => e.type === "test");
      expect(testEvent).toBeDefined();
      expect(testEvent?.command).toBe("npm test");
      expect(testEvent?.success).toBe(false);
      expect(testEvent?.metadata).toMatchObject({
        attempted: true,
        failed: true,
        error: "FAIL: 1 test failed",
      });

      // Followed by tool_result error events
      const errorResults = s1.events.filter((e) => e.type === "error");
      expect(errorResults).toHaveLength(2);

      // Critical check: failed write does NOT count as a successful file write!
      const touches1 = extractFileTouches(s1.id, s1.events);
      const authTouch = touches1.find((t) => t.file === "src/auth.ts");
      expect(authTouch).toBeDefined();
      expect(authTouch?.read).toBe(true);
      expect(authTouch?.written).toBe(false); // MUST BE FALSE!

      // 3. Validate Transcript 2: successful write counts as written: true
      const s2 = await claudeAdapter.loadSession(
        "transcript-2-success",
        context,
      );
      const touches2 = extractFileTouches(s2.id, s2.events);
      const dbTouch = touches2.find((t) => t.file === "src/db.ts");
      expect(dbTouch?.read).toBe(true);
      expect(dbTouch?.written).toBe(true);
      const summary2 = summarizeSession(s2);
      expect(summary2.touchedFileCount).toBe(1);

      // 4. Validate Transcript 3: research session with no files touched
      const s3 = await claudeAdapter.loadSession(
        "transcript-3-research",
        context,
      );
      expect(s3.events.find((e) => e.type === "unknown")).toBeDefined();
      const touches3 = extractFileTouches(s3.id, s3.events);
      expect(touches3).toHaveLength(0);
      const summary3 = summarizeSession(s3);
      expect(summary3.touchedFileCount).toBe(0);
    });
  });
});
