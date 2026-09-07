import { describe, it, expect } from "vitest";
import {
  normalizePath,
  summarizeSession,
  createNormalizedSession,
  type Confidence,
  type Evidence,
  type EvidenceKind,
  type NormalizedSession,
  type ProvenanceCandidate,
} from "../../src/core/sessions.js";
import { type NormalizedEvent } from "../../src/core/events.js";

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

describe("createNormalizedSession", () => {
  it("preserves undefined startedAt when not provided (never fabricates dates)", () => {
    const created = createNormalizedSession({
      id: "s1",
      agent: "claude",
    });

    expect(created.id).toBe("s1");
    expect(created.agent).toBe("claude");
    expect(created.events).toEqual([]);
    expect(created.startedAt).toBeUndefined();
  });

  it("preserves explicitly provided startedAt and optional fields", () => {
    const ts = new Date(1000);
    const events = [event("e1", "s1", "prompt", { file: "src/a.ts" })];
    const created = createNormalizedSession({
      id: "s1",
      agent: "claude",
      startedAt: ts,
      events,
      prompt: "hello",
    });
    expect(created.events).toBe(events);
    expect(created.startedAt).toBe(ts);
    expect(created.prompt).toBe("hello");
  });
});

describe("summarizeSession", () => {
  const baseSession: NormalizedSession = {
    id: "s1",
    agent: "claude",
    startedAt: new Date(1000),
    endedAt: new Date(2000),
    prompt: "Fix authentication",
    events: [],
  };

  it("returns a summary with event count, touched file count, and startedAt", () => {
    const session: NormalizedSession = {
      ...baseSession,
      events: [
        event("a", "s1", "read", { file: "src/auth.ts" }),
        event("b", "s1", "write", { file: "src/auth.ts" }),
        event("c", "s1", "read", { file: "tests/auth.test.ts" }),
        event("d", "s1", "command", { command: "npm test" }),
      ],
    };
    const summary = summarizeSession(session);
    expect(summary.id).toBe("s1");
    expect(summary.agent).toBe("claude");
    expect(summary.startedAt).toBe(baseSession.startedAt);
    expect(summary.endedAt).toBe(baseSession.endedAt);
    expect(summary.eventCount).toBe(4);
    expect(summary.touchedFileCount).toBe(2);
    expect(summary.promptPreview).toBe("Fix authentication");
  });

  it("preserves undefined startedAt when session lacks start timestamp", () => {
    const session: NormalizedSession = {
      id: "s2",
      agent: "claude",
      events: [],
    };
    const summary = summarizeSession(session);
    expect(summary.startedAt).toBeUndefined();
  });

  it("truncates long prompts to 100 characters with ellipsis", () => {
    const longPrompt = "x".repeat(120);
    const session: NormalizedSession = {
      ...baseSession,
      prompt: longPrompt,
      events: [],
    };
    const summary = summarizeSession(session);
    expect(summary.promptPreview?.length).toBe(100);
    expect(summary.promptPreview?.endsWith("...")).toBe(true);
  });

  it("uses the first line of a multiline prompt", () => {
    const session: NormalizedSession = {
      ...baseSession,
      prompt: "Fix the bug\n\nIt is on line 42\nand needs review",
      events: [],
    };
    expect(summarizeSession(session).promptPreview).toBe("Fix the bug");
  });

  it("returns undefined promptPreview when prompt is missing or empty", () => {
    const empty: NormalizedSession = {
      id: baseSession.id,
      agent: baseSession.agent,
      startedAt: baseSession.startedAt,
      events: [],
    };
    const whitespace: NormalizedSession = {
      ...baseSession,
      prompt: "   \n\t  ",
      events: [],
    };
    expect(summarizeSession(empty).promptPreview).toBeUndefined();
    expect(summarizeSession(whitespace).promptPreview).toBeUndefined();
  });

  it("handles empty events array safely", () => {
    const session: NormalizedSession = { ...baseSession, events: [] };
    const summary = summarizeSession(session);
    expect(summary.eventCount).toBe(0);
    expect(summary.touchedFileCount).toBe(0);
  });

  it("counts only unique non-empty file values", () => {
    const session: NormalizedSession = {
      ...baseSession,
      events: [
        event("a", "s1", "read", { file: "src/a.ts" }),
        event("b", "s1", "read", { file: "src/a.ts" }),
        event("c", "s1", "read", { file: "" }),
        event("d", "s1", "command", { command: "ls" }),
      ],
    };
    expect(summarizeSession(session).touchedFileCount).toBe(1);
  });
});

describe("normalizePath", () => {
  it("returns empty string for empty input", () => {
    expect(normalizePath("")).toBe("");
  });

  it("relativizes POSIX absolute path against repoRoot", () => {
    expect(
      normalizePath("/home/user/project/src/auth.ts", "/home/user/project"),
    ).toBe("src/auth.ts");
  });

  it("relativizes Windows backslash path against repoRoot", () => {
    expect(
      normalizePath("C:\\project\\src\\auth.ts", "C:\\project"),
    ).toBe("src/auth.ts");
  });

  it("matches Windows drive letters case-insensitively", () => {
    expect(normalizePath("c:/project/src/auth.ts", "C:/project")).toBe(
      "src/auth.ts",
    );
    expect(normalizePath("C:\\project\\src\\auth.ts", "c:\\project")).toBe(
      "src/auth.ts",
    );
  });

  it("strips a leading ./ from repo-relative paths", () => {
    expect(normalizePath("./src/auth.ts")).toBe("src/auth.ts");
  });

  it("leaves a clean repo-relative path unchanged", () => {
    expect(normalizePath("src/auth.ts")).toBe("src/auth.ts");
  });

  it("converts Windows backslashes on a relative path", () => {
    expect(normalizePath("src\\auth\\token.ts")).toBe("src/auth/token.ts");
  });

  it("resolves .. segments in a relative path", () => {
    expect(normalizePath("src/../tests/unit/cli.test.ts")).toBe(
      "tests/unit/cli.test.ts",
    );
  });

  it("preserves filenames with spaces", () => {
    expect(normalizePath("src/my dir/file.ts")).toBe("src/my dir/file.ts");
  });

  it("returns the cleaned absolute path when outside the repo", () => {
    expect(normalizePath("/var/log/syslog", "/home/user/project")).toBe(
      "/var/log/syslog",
    );
    expect(normalizePath("D:/other/file.ts", "C:/project")).toBe(
      "D:/other/file.ts",
    );
  });

  it("normalizes a root path inside repoRoot to empty string", () => {
    expect(normalizePath("/home/user/project", "/home/user/project")).toBe("");
  });

  it("collapses consecutive slashes", () => {
    expect(normalizePath("src//auth///token.ts")).toBe("src/auth/token.ts");
  });
  it("resolves .. inside repo before checking containment", () => {
    expect(normalizePath("/repo/src/../a.ts", "/repo")).toBe("a.ts");
    expect(normalizePath("C:\\repo\\src\\..\\a.ts", "C:\\repo")).toBe("a.ts");
  });

  it("keeps paths that navigate outside the repo as absolute paths", () => {
    expect(normalizePath("/repo/../outside.ts", "/repo")).toBe("/outside.ts");
    expect(normalizePath("C:\\repo\\..\\outside.ts", "C:\\repo")).toBe(
      "C:/outside.ts",
    );
  });

  it("avoids root-prefix collisions like /repo vs /repo-old", () => {
    expect(normalizePath("/repo-old/a.ts", "/repo")).toBe("/repo-old/a.ts");
    expect(normalizePath("C:\\repo-old\\a.ts", "C:\\repo")).toBe(
      "C:/repo-old/a.ts",
    );
  });
});

describe("Provenance / Confidence type shapes", () => {
  it("Confidence is a qualitative union without hardcoded score ranges", () => {
    const values: Confidence[] = [
      "confirmed",
      "strong",
      "possible",
      "unknown",
    ];
    for (const value of values) {
      expect(typeof value).toBe("string");
    }
  });

  it("Evidence weight is optional so Step 1 does not lock in scoring policy", () => {
    const evidenceWithoutWeight: Evidence = {
      kind: "explicit_file_edit",
      description: "Edited file",
    };
    expect(evidenceWithoutWeight.weight).toBeUndefined();

    const candidateWithoutScore: ProvenanceCandidate = {
      sessionId: "s1",
      agent: "claude",
      evidence: [evidenceWithoutWeight],
    };
    expect(candidateWithoutScore.score).toBeUndefined();
  });

  it("EvidenceKind includes all 9 documented categories", () => {
    const kinds: EvidenceKind[] = [
      "explicit_file_edit",
      "line_overlap",
      "file_touch",
      "timestamp_proximity",
      "commit_proximity",
      "blame_commit_match",
      "test_reference",
      "command_reference",
      "project_path_match",
    ];
    expect(kinds).toHaveLength(9);
  });
});
