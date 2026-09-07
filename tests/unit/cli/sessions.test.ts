import { describe, it, expect } from "vitest";
import path from "node:path";
import { Command } from "commander";
import { program } from "../../../src/cli/program.js";
import {
  collectSessionsReport,
  formatSessionsReport,
  formatSessionId,
  sortSessionsDeterministically,
  registerSessionsCommand,
  type SessionsReport,
} from "../../../src/cli/commands/sessions.js";
import { withTempRepo, withTempDir } from "../../helpers/temp-repo.js";
import type {
  AdapterContext,
  AgentAdapter,
} from "../../../src/adapters/types.js";
import type { NormalizedSessionSummary } from "../../../src/core/sessions.js";

describe("sessions command registration", () => {
  it("registers sessions subcommand on the main program", () => {
    const sessionsCmd = program.commands.find((c) => c.name() === "sessions");
    expect(sessionsCmd).toBeDefined();
    expect(sessionsCmd?.description()).toContain("sessions associated with the current repository");
  });

  it("registers on an independent Commander instance", () => {
    const testProgram = new Command();
    registerSessionsCommand(testProgram);
    const cmd = testProgram.commands.find((c) => c.name() === "sessions");
    expect(cmd).toBeDefined();
  });
});

describe("formatSessionId", () => {
  it("preserves IDs shorter than or equal to 8 characters", () => {
    expect(formatSessionId("abc")).toBe("abc");
    expect(formatSessionId("12345678")).toBe("12345678");
  });

  it("shortens UUIDs and long IDs to first 8 characters when unique", () => {
    const id = "a84f29c1-4567-489a-bcde-1234567890ab";
    expect(formatSessionId(id, [id, "other-id-123"])).toBe("a84f29c1");
  });

  it("preserves full ID when there is a prefix collision", () => {
    const id1 = "a84f29c1-1111-489a-bcde-1234567890ab";
    const id2 = "a84f29c1-2222-489a-bcde-1234567890ab";
    expect(formatSessionId(id1, [id1, id2])).toBe(id1);
    expect(formatSessionId(id2, [id1, id2])).toBe(id2);
  });
});

describe("sortSessionsDeterministically", () => {
  it("places newest sessions first", () => {
    const s1: Pick<NormalizedSessionSummary, "id" | "agent" | "startedAt"> = {
      id: "s1",
      agent: "claude",
      startedAt: new Date("2026-09-07T10:00:00.000Z"),
    };
    const s2: Pick<NormalizedSessionSummary, "id" | "agent" | "startedAt"> = {
      id: "s2",
      agent: "claude",
      startedAt: new Date("2026-09-07T14:00:00.000Z"),
    };
    const s3: Pick<NormalizedSessionSummary, "id" | "agent" | "startedAt"> = {
      id: "s3",
      agent: "claude",
      startedAt: new Date("2026-09-07T12:00:00.000Z"),
    };

    const sorted = sortSessionsDeterministically([s1, s2, s3]);
    expect(sorted.map((s) => s.id)).toEqual(["s2", "s3", "s1"]);
  });

  it("places unknown timestamps after known timestamps", () => {
    const sKnown: Pick<NormalizedSessionSummary, "id" | "agent" | "startedAt"> = {
      id: "s-known",
      agent: "claude",
      startedAt: new Date("2026-09-07T10:00:00.000Z"),
    };
    const sUnknown: Pick<NormalizedSessionSummary, "id" | "agent" | "startedAt"> = {
      id: "s-unknown",
      agent: "claude",
      startedAt: undefined,
    };

    const sorted = sortSessionsDeterministically([sUnknown, sKnown]);
    expect(sorted.map((s) => s.id)).toEqual(["s-known", "s-unknown"]);
  });

  it("uses agent then id as a stable tie-breaker", () => {
    const s1 = { id: "b-id", agent: "claude", startedAt: undefined };
    const s2 = { id: "a-id", agent: "claude", startedAt: undefined };
    const s3 = { id: "z-id", agent: "adapter-a", startedAt: undefined };

    const sorted = sortSessionsDeterministically([s1, s2, s3]);
    expect(sorted.map((s) => s.id)).toEqual(["z-id", "a-id", "b-id"]);
  });
});

describe("collectSessionsReport", () => {
  it("returns isRepo=false when called outside a git repository", async () => {
    await withTempDir(async (tempDir) => {
      const context: AdapterContext = {
        cwd: tempDir,
        homeDir: tempDir,
      };

      const report = await collectSessionsReport(context);
      expect(report.isRepo).toBe(false);
      expect(report.sessions).toEqual([]);
    });
  });

  it("lists matching sessions for the current repository and excludes others", async () => {
    await withTempRepo(async (repoRoot) => {
      const mockAdapter: AgentAdapter = {
        id: "claude",
        displayName: "Claude Code",
        detect: async () => ({ detected: true, sourcePaths: [] }),
        listSessions: async () => [
          {
            id: "session-matching-root",
            agent: "claude",
            projectPath: repoRoot,
            startedAt: new Date("2026-09-07T12:00:00.000Z"),
            eventCount: 42,
          },
          {
            id: "session-matching-subdir",
            agent: "claude",
            projectPath: path.join(repoRoot, "packages", "web"),
            startedAt: new Date("2026-09-07T14:00:00.000Z"),
            eventCount: 10,
          },
          {
            id: "session-other-repo",
            agent: "claude",
            projectPath: "/other/workspace/project",
            startedAt: new Date("2026-09-07T15:00:00.000Z"),
          },
          {
            id: "session-no-path-evidence",
            agent: "claude",
            // missing projectPath
            startedAt: new Date("2026-09-07T16:00:00.000Z"),
          },
        ],
        loadSession: async () => { throw new Error(); },
      };

      const context: AdapterContext = {
        cwd: repoRoot,
        homeDir: repoRoot,
      };

      const report = await collectSessionsReport(context, {
        adapters: [mockAdapter],
      });

      expect(report.isRepo).toBe(true);
      expect(report.repoRoot).toBeDefined();

      // Only the two sessions matching the repo root or its subdirectories must be present
      expect(report.sessions).toHaveLength(2);
      // Newest first: 14:00 before 12:00
      expect(report.sessions[0]?.id).toBe("session-matching-subdir");
      // Prefix collision (both start with "session-") causes formatSessionId to preserve full ID
      expect(report.sessions[0]?.shortId).toBe("session-matching-subdir");
      expect(report.sessions[1]?.shortId).toBe("session-matching-root");
      expect(report.sessions[1]?.id).toBe("session-matching-root");

      expect(report.sessions[0]?.agentDisplayName).toBe("Claude Code");
      expect(report.sessions[0]?.eventCount).toBe(10);
    });
  });

  it("combines results across multiple adapter implementations in an agent-agnostic way", async () => {
    await withTempRepo(async (repoRoot) => {
      const adapterA: AgentAdapter = {
        id: "claude",
        displayName: "Claude Code",
        detect: async () => ({ detected: true, sourcePaths: [] }),
        listSessions: async () => [
          {
            id: "claude-sess-1",
            agent: "claude",
            projectPath: repoRoot,
            startedAt: new Date("2026-09-07T10:00:00.000Z"),
            eventCount: 20,
          },
        ],
        loadSession: async () => { throw new Error(); },
      };

      const adapterB: AgentAdapter = {
        id: "codex",
        displayName: "Codex Agent",
        detect: async () => ({ detected: true, sourcePaths: [] }),
        listSessions: async () => [
          {
            id: "codex-sess-1",
            agent: "codex",
            projectPath: repoRoot,
            startedAt: new Date("2026-09-07T11:00:00.000Z"),
            eventCount: 35,
          },
        ],
        loadSession: async () => { throw new Error(); },
      };

      const context: AdapterContext = { cwd: repoRoot, homeDir: repoRoot };
      const report = await collectSessionsReport(context, {
        adapters: [adapterA, adapterB],
      });

      expect(report.sessions).toHaveLength(2);
      // Newest first (Codex at 11:00 before Claude at 10:00)
      expect(report.sessions[0]?.id).toBe("codex-sess-1");
      expect(report.sessions[0]?.agentDisplayName).toBe("Codex Agent");
      expect(report.sessions[1]?.id).toBe("claude-sess-1");
      expect(report.sessions[1]?.agentDisplayName).toBe("Claude Code");
    });
  });

  it("does not crash when an adapter throws, and records a diagnostic warning", async () => {
    await withTempRepo(async (repoRoot) => {
      const failingAdapter: AgentAdapter = {
        id: "broken",
        displayName: "Broken Agent",
        detect: async () => ({ detected: true, sourcePaths: [] }),
        listSessions: async () => {
          throw new Error("EACCES: permission denied");
        },
        loadSession: async () => { throw new Error(); },
      };

      const workingAdapter: AgentAdapter = {
        id: "working",
        displayName: "Working Agent",
        detect: async () => ({ detected: true, sourcePaths: [] }),
        listSessions: async () => [
          {
            id: "working-1",
            agent: "working",
            projectPath: repoRoot,
            startedAt: new Date("2026-09-07T12:00:00.000Z"),
          },
        ],
        loadSession: async () => { throw new Error(); },
      };

      const context: AdapterContext = { cwd: repoRoot, homeDir: repoRoot };
      const report = await collectSessionsReport(context, {
        adapters: [failingAdapter, workingAdapter],
      });

      expect(report.isRepo).toBe(true);
      expect(report.sessions).toHaveLength(1);
      expect(report.sessions[0]?.id).toBe("working-1");
      expect(report.warnings).toBeDefined();
      expect(report.warnings?.[0]).toContain("Failed to list sessions for Broken Agent");
    });
  });

  it("handles empty matching set cleanly", async () => {
    await withTempRepo(async (repoRoot) => {
      const adapter: AgentAdapter = {
        id: "claude",
        displayName: "Claude Code",
        detect: async () => ({ detected: true, sourcePaths: [] }),
        listSessions: async () => [],
        loadSession: async () => { throw new Error(); },
      };

      const context: AdapterContext = { cwd: repoRoot, homeDir: repoRoot };
      const report = await collectSessionsReport(context, {
        adapters: [adapter],
      });

      expect(report.isRepo).toBe(true);
      expect(report.sessions).toEqual([]);
    });
  });
});

describe("formatSessionsReport", () => {
  it("formats table output matching the specified CLI style", () => {
    const report: SessionsReport = {
      isRepo: true,
      repoRoot: "C:/dev/Originlog",
      sessions: [
        {
          id: "a84f29c1-4567-489a-bcde-1234567890ab",
          shortId: "a84f29c1",
          agent: "claude",
          agentDisplayName: "Claude Code",
          startedAt: new Date("2026-09-07T14:21:00.000Z"),
          eventCount: 37,
        },
        {
          id: "8d101c22-1111-2222-3333-444455556666",
          shortId: "8d101c22",
          agent: "claude",
          agentDisplayName: "Claude Code",
          startedAt: new Date("2026-09-07T12:03:00.000Z"),
          eventCount: 19,
        },
        {
          id: "c993ad14-0000-0000-0000-000000000000",
          shortId: "c993ad14",
          agent: "claude",
          agentDisplayName: "Claude Code",
          startedAt: undefined,
          eventCount: undefined,
        },
      ],
    };

    const text = formatSessionsReport(report, { color: false, utc: true });

    expect(text).toContain("Originlog sessions");
    expect(text).toContain("Repository: C:/dev/Originlog");
    expect(text).toContain("AGENT");
    expect(text).toContain("SESSION");
    expect(text).toContain("STARTED");
    expect(text).toContain("EVENTS");
    expect(text).toContain("Claude Code  a84f29c1  2026-09-07 14:21  37");
    expect(text).toContain("Claude Code  8d101c22  2026-09-07 12:03  19");
    expect(text).toContain("Claude Code  c993ad14  unknown           unknown");
    expect(text).toContain("3 sessions");
  });

  it("formats singular '1 session' footer when exactly one session matches", () => {
    const report: SessionsReport = {
      isRepo: true,
      repoRoot: "/repo",
      sessions: [
        {
          id: "s1",
          shortId: "s1",
          agent: "claude",
          agentDisplayName: "Claude Code",
          startedAt: new Date("2026-09-07T10:00:00.000Z"),
          eventCount: 5,
        },
      ],
    };

    const text = formatSessionsReport(report, { color: false });
    expect(text).toContain("1 session");
  });

  it("formats empty state cleanly without throwing", () => {
    const report: SessionsReport = {
      isRepo: true,
      repoRoot: "C:/dev/Originlog",
      sessions: [],
    };

    const text = formatSessionsReport(report, { color: false });
    expect(text).toContain("Originlog sessions");
    expect(text).toContain("Repository: C:/dev/Originlog");
    expect(text).toContain("No matching coding-agent sessions found.");
  });

  it("formats non-repo error state cleanly", () => {
    const report: SessionsReport = {
      isRepo: false,
      sessions: [],
    };

    const text = formatSessionsReport(report, { color: false });
    expect(text).toContain("Originlog sessions");
    expect(text).toContain("✕ Git repository");
    expect(text).toContain("Not a git repository (run inside a repository to trace changes)");
  });
});
