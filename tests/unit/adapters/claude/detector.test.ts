import { describe, it, expect } from "vitest";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  detectClaude,
  getClaudeCandidatePaths,
  toPosixPath,
  isPathMatchingProject,
} from "../../../../src/adapters/claude/detector.js";
import type { AdapterContext } from "../../../../src/adapters/types.js";

async function withTempContext(
  callback: (context: AdapterContext, tempRoot: string) => Promise<void>,
): Promise<void> {
  const tempRoot = await fs.mkdtemp(
    path.join(os.tmpdir(), "originlog-claude-test-"),
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

describe("toPosixPath", () => {
  it("converts Windows backslashes to forward slashes", () => {
    expect(toPosixPath("C:\\Users\\user\\.claude")).toBe(
      "C:/Users/user/.claude",
    );
  });

  it("strips trailing slash while preserving root", () => {
    expect(toPosixPath("/home/user/.claude/")).toBe("/home/user/.claude");
    expect(toPosixPath("/")).toBe("/");
  });

  it("handles empty input", () => {
    expect(toPosixPath("")).toBe("");
  });
});

describe("isPathMatchingProject", () => {
  it("matches identical paths", () => {
    expect(isPathMatchingProject("/repo/foo", "/repo/foo")).toBe(true);
  });

  it("matches Windows paths case-insensitively with mixed slashes", () => {
    expect(
      isPathMatchingProject("C:\\Project\\MyRepo", "c:/project/myrepo"),
    ).toBe(true);
  });

  it("returns false for different paths", () => {
    expect(isPathMatchingProject("/repo/a", "/repo/b")).toBe(false);
  });

  it("returns false when either path is undefined", () => {
    expect(isPathMatchingProject(undefined, "/repo/a")).toBe(false);
    expect(isPathMatchingProject("/repo/a", undefined)).toBe(false);
  });
});

describe("getClaudeCandidatePaths", () => {
  it("returns candidate paths for global and local locations", () => {
    const context: AdapterContext = {
      cwd: "C:\\work\\repo",
      repoRoot: "C:\\work\\repo",
      homeDir: "C:\\Users\\test",
    };
    const paths = getClaudeCandidatePaths(context);
    expect(paths.some((p) => p.includes(".claude"))).toBe(true);
    expect(paths.some((p) => p.includes("history.jsonl"))).toBe(true);
    expect(paths.some((p) => p.includes("sessions"))).toBe(true);
    expect(paths.some((p) => p.includes("projects"))).toBe(true);
    expect(paths.some((p) => p.includes("work/repo/.claude"))).toBe(true);
  });
});

describe("detectClaude — found locations", () => {
  it("detects Claude when ~/.claude directory exists with history.jsonl", async () => {
    await withTempContext(async (context) => {
      const claudeDir = path.join(context.homeDir, ".claude");
      await fs.mkdir(claudeDir, { recursive: true });

      const historyPath = path.join(claudeDir, "history.jsonl");
      const lines = [
        JSON.stringify({ display: "task 1", sessionId: "sess-1" }),
        JSON.stringify({ display: "task 2", sessionId: "sess-2" }),
        JSON.stringify({ display: "task 1 retry", sessionId: "sess-1" }),
      ].join("\n");
      await fs.writeFile(historyPath, lines, "utf8");

      const detection = await detectClaude(context);
      expect(detection.detected).toBe(true);
      expect(detection.sourcePaths.some((p) => p.endsWith("history.jsonl"))).toBe(
        true,
      );
      expect(detection.sessionCount).toBe(2);
      expect(detection.warnings).toBeUndefined();
    });
  });

  it("detects session files in ~/.claude/sessions/", async () => {
    await withTempContext(async (context) => {
      const sessionsDir = path.join(context.homeDir, ".claude", "sessions");
      await fs.mkdir(sessionsDir, { recursive: true });

      await fs.writeFile(
        path.join(sessionsDir, "session-a.json"),
        "{}",
        "utf8",
      );
      await fs.writeFile(
        path.join(sessionsDir, "session-b.jsonl"),
        "{}",
        "utf8",
      );

      const detection = await detectClaude(context);
      expect(detection.detected).toBe(true);
      expect(detection.sessionCount).toBe(2);
    });
  });

  it("detects nested session files in ~/.claude/projects/<subfolder>/", async () => {
    await withTempContext(async (context) => {
      const projectSubDir = path.join(
        context.homeDir,
        ".claude",
        "projects",
        "C--work-my-project",
      );
      await fs.mkdir(projectSubDir, { recursive: true });

      await fs.writeFile(
        path.join(projectSubDir, "sess-1.jsonl"),
        "{}",
        "utf8",
      );
      await fs.writeFile(
        path.join(projectSubDir, "sess-2.jsonl"),
        "{}",
        "utf8",
      );

      const detection = await detectClaude(context);
      expect(detection.detected).toBe(true);
      expect(detection.sessionCount).toBe(2);
    });
  });

  it("detects local repository .claude/ directory", async () => {
    await withTempContext(async (context) => {
      const localClaude = path.join(context.repoRoot!, ".claude");
      await fs.mkdir(localClaude, { recursive: true });

      const detection = await detectClaude(context);
      expect(detection.detected).toBe(true);
      expect(
        detection.sourcePaths.some((p) =>
          p.includes(toPosixPath(localClaude)),
        ),
      ).toBe(true);
    });
  });
});

describe("detectClaude — missing locations", () => {
  it("returns detected: false when no Claude directories exist", async () => {
    await withTempContext(async (context) => {
      const detection = await detectClaude(context);
      expect(detection.detected).toBe(false);
      expect(detection.sourcePaths).toHaveLength(0);
      expect(detection.sessionCount).toBeUndefined();
      expect(detection.warnings).toBeUndefined();
    });
  });

  it("returns detected: false when homeDir and repoRoot do not exist", async () => {
    const context: AdapterContext = {
      cwd: "/nonexistent/cwd",
      repoRoot: "/nonexistent/repo",
      homeDir: "/nonexistent/home",
    };
    const detection = await detectClaude(context);
    expect(detection.detected).toBe(false);
    expect(detection.sourcePaths).toHaveLength(0);
  });
});

describe("detectClaude — malformed locations", () => {
  it("skips malformed lines in history.jsonl and reports diagnostic warnings", async () => {
    await withTempContext(async (context) => {
      const claudeDir = path.join(context.homeDir, ".claude");
      await fs.mkdir(claudeDir, { recursive: true });

      const historyPath = path.join(claudeDir, "history.jsonl");
      const content = [
        JSON.stringify({ display: "valid 1", sessionId: "sess-valid-1" }),
        "{malformed-json-line",
        "not-even-json",
        JSON.stringify({ display: "valid 2", sessionId: "sess-valid-2" }),
      ].join("\n");
      await fs.writeFile(historyPath, content, "utf8");

      const detection = await detectClaude(context);
      expect(detection.detected).toBe(true);
      expect(detection.sessionCount).toBe(2);
      expect(detection.warnings).toBeDefined();
      expect(detection.warnings!.length).toBeGreaterThanOrEqual(2);
      expect(
        detection.warnings!.some((w) => w.includes("Malformed entry at line 2")),
      ).toBe(true);
    });
  });

  it("handles non-object JSON in history.jsonl as malformed", async () => {
    await withTempContext(async (context) => {
      const claudeDir = path.join(context.homeDir, ".claude");
      await fs.mkdir(claudeDir, { recursive: true });

      const historyPath = path.join(claudeDir, "history.jsonl");
      const content = [
        "12345",
        JSON.stringify([1, 2, 3]),
        JSON.stringify({ display: "ok", sessionId: "sess-ok" }),
      ].join("\n");
      await fs.writeFile(historyPath, content, "utf8");

      const detection = await detectClaude(context);
      expect(detection.detected).toBe(true);
      expect(detection.sessionCount).toBe(1);
      expect(detection.warnings?.length).toBeGreaterThanOrEqual(2);
    });
  });
});

describe("detectClaude — empty locations", () => {
  it("reports detected: true with sessionCount: 0 for empty ~/.claude", async () => {
    await withTempContext(async (context) => {
      const claudeDir = path.join(context.homeDir, ".claude");
      await fs.mkdir(claudeDir, { recursive: true });

      const detection = await detectClaude(context);
      expect(detection.detected).toBe(true);
      expect(detection.sessionCount).toBe(0);
      expect(detection.warnings).toBeUndefined();
    });
  });

  it("reports sessionCount: 0 for empty 0-byte history.jsonl", async () => {
    await withTempContext(async (context) => {
      const claudeDir = path.join(context.homeDir, ".claude");
      await fs.mkdir(claudeDir, { recursive: true });
      await fs.writeFile(path.join(claudeDir, "history.jsonl"), "", "utf8");

      const detection = await detectClaude(context);
      expect(detection.detected).toBe(true);
      expect(detection.sessionCount).toBe(0);
    });
  });

  it("reports sessionCount: 0 for empty sessions/ directory", async () => {
    await withTempContext(async (context) => {
      const sessionsDir = path.join(context.homeDir, ".claude", "sessions");
      await fs.mkdir(sessionsDir, { recursive: true });

      const detection = await detectClaude(context);
      expect(detection.detected).toBe(true);
      expect(detection.sessionCount).toBe(0);
    });
  });

  it("reports sessionCount: 0 for empty projects/ directory", async () => {
    await withTempContext(async (context) => {
      const projectsDir = path.join(context.homeDir, ".claude", "projects");
      await fs.mkdir(projectsDir, { recursive: true });

      const detection = await detectClaude(context);
      expect(detection.detected).toBe(true);
      expect(detection.sessionCount).toBe(0);
    });
  });
});
