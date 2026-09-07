import { describe, it, expect } from "vitest";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { claudeAdapter } from "../../../../src/adapters/claude/adapter.js";
import { detectClaude } from "../../../../src/adapters/claude/detector.js";
import type { AdapterContext } from "../../../../src/adapters/types.js";

async function withTempContext(
  callback: (context: AdapterContext, tempRoot: string) => Promise<void>,
): Promise<void> {
  const tempRoot = await fs.mkdtemp(
    path.join(os.tmpdir(), "originlog-claude-adapter-test-"),
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

describe("claudeAdapter metadata", () => {
  it("has the expected id and displayName", () => {
    expect(claudeAdapter.id).toBe("claude");
    expect(claudeAdapter.displayName).toBe("Claude Code");
  });
});

describe("claudeAdapter.detect", () => {
  it("delegates to detectClaude", async () => {
    await withTempContext(async (context) => {
      const direct = await detectClaude(context);
      const viaAdapter = await claudeAdapter.detect(context);
      expect(viaAdapter).toEqual(direct);
    });
  });
});

describe("claudeAdapter.listSessions", () => {
  it("returns empty array when no Claude data is detected", async () => {
    await withTempContext(async (context) => {
      const sessions = await claudeAdapter.listSessions(context);
      expect(sessions).toEqual([]);
    });
  });

  it("lists sessions discovered in projects directory, sorted by startedAt descending", async () => {
    await withTempContext(async (context) => {
      const projectsDir = path.join(context.homeDir, ".claude", "projects", "my-project");
      await fs.mkdir(projectsDir, { recursive: true });

      // Session A: earlier timestamp
      const sessionAContent = [
        JSON.stringify({
          type: "user",
          sessionId: "session-a",
          timestamp: "2026-07-20T10:00:00.000Z",
          promptId: "p-a",
          cwd: context.cwd,
          message: { role: "user", content: "Task A" },
        }),
      ].join("\n");

      // Session B: later timestamp
      const sessionBContent = [
        JSON.stringify({
          type: "user",
          sessionId: "session-b",
          timestamp: "2026-07-25T14:00:00.000Z",
          promptId: "p-b",
          cwd: context.cwd,
          message: { role: "user", content: "Task B: Refactor module" },
        }),
      ].join("\n");

      await fs.writeFile(path.join(projectsDir, "session-a.jsonl"), sessionAContent, "utf8");
      await fs.writeFile(path.join(projectsDir, "session-b.jsonl"), sessionBContent, "utf8");

      const list = await claudeAdapter.listSessions(context);
      expect(list).toHaveLength(2);

      // Most recent first: session-b, then session-a
      expect(list[0]?.id).toBe("session-b");
      expect(list[0]?.agent).toBe("claude");
      expect(list[0]?.promptPreview).toBe("Task B: Refactor module");
      expect(list[0]?.startedAt).toEqual(new Date("2026-07-25T14:00:00.000Z"));

      expect(list[1]?.id).toBe("session-a");
      expect(list[1]?.promptPreview).toBe("Task A");
    });
  });
});

describe("claudeAdapter.loadSession", () => {
  it("loads a full normalized session by its sessionId", async () => {
    await withTempContext(async (context) => {
      const projectsDir = path.join(context.homeDir, ".claude", "projects", "my-project");
      await fs.mkdir(projectsDir, { recursive: true });

      const content = [
        JSON.stringify({
          type: "user",
          sessionId: "session-target-1",
          uuid: "u-1",
          timestamp: "2026-07-24T12:00:00.000Z",
          promptId: "p-1",
          cwd: context.cwd,
          message: { role: "user", content: "Implement user authentication" },
        }),
        JSON.stringify({
          type: "assistant",
          sessionId: "session-target-1",
          uuid: "u-2",
          timestamp: "2026-07-24T12:01:00.000Z",
          message: {
            role: "assistant",
            content: [
              {
                type: "tool_use",
                id: "toolu_edit_1",
                name: "Edit",
                input: {
                  file_path: "src/auth.ts",
                  new_string: "export const auth = true;",
                },
              },
            ],
          },
        }),
      ].join("\n");

      await fs.writeFile(
        path.join(projectsDir, "session-target-1.jsonl"),
        content,
        "utf8",
      );

      const session = await claudeAdapter.loadSession("session-target-1", context);

      expect(session.id).toBe("session-target-1");
      expect(session.agent).toBe("claude");
      expect(session.prompt).toBe("Implement user authentication");
      expect(session.events).toHaveLength(2);
      expect(session.events[0]?.type).toBe("prompt");
      expect(session.events[1]?.type).toBe("write");
      expect(session.events[1]?.file).toBe("src/auth.ts");
    });
  });

  it("throws an error if sessionId is not found", async () => {
    await withTempContext(async (context) => {
      await expect(
        claudeAdapter.loadSession("nonexistent-session-id", context),
      ).rejects.toThrow("Session not found: nonexistent-session-id");
    });
  });
});
