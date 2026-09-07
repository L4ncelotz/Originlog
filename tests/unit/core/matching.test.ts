import { describe, it, expect } from "vitest";
import {
  matchSessionToRepository,
  filterSessionsForRepository,
  matchSessionsToRepository,
  type NormalizedSession,
  type NormalizedSessionSummary,
} from "../../../src/index.js";

describe("matchSessionToRepository", () => {
  describe("exact root matching", () => {
    it("matches when session projectPath exactly equals repoRoot (POSIX)", () => {
      const session: NormalizedSessionSummary = {
        id: "sess-1",
        agent: "claude",
        projectPath: "/work/my-project",
      };

      const match = matchSessionToRepository(session, "/work/my-project");

      expect(match.matched).toBe(true);
      expect(match.reason).toBe("Working directory exactly matches repository root.");
      expect(match.repoRoot).toBe("/work/my-project");
      expect(match.sessionPath).toBe("/work/my-project");
    });

    it("matches when session projectPath exactly equals repoRoot (Windows)", () => {
      const session: NormalizedSession = {
        id: "sess-win-1",
        agent: "claude",
        projectPath: "C:/Users/dev/my-project",
        events: [],
      };

      const match = matchSessionToRepository(session, "C:/Users/dev/my-project");

      expect(match.matched).toBe(true);
      expect(match.reason).toBe("Working directory exactly matches repository root.");
      expect(match.repoRoot).toBe("C:/Users/dev/my-project");
      expect(match.sessionPath).toBe("C:/Users/dev/my-project");
    });
  });

  describe("descendant subdirectory matching", () => {
    it("matches when session is in a direct subdirectory", () => {
      const session: NormalizedSessionSummary = {
        id: "sess-sub-1",
        agent: "claude",
        projectPath: "/work/my-project/packages/web",
      };

      const match = matchSessionToRepository(session, "/work/my-project");

      expect(match.matched).toBe(true);
      expect(match.reason).toBe(
        'Working directory is inside repository subdirectory "packages/web".',
      );
      expect(match.repoRoot).toBe("/work/my-project");
      expect(match.sessionPath).toBe("/work/my-project/packages/web");
    });

    it("matches when session is in a deeply nested subdirectory", () => {
      const session: NormalizedSessionSummary = {
        id: "sess-sub-deep",
        agent: "claude",
        projectPath: "C:/repo/apps/frontend/src/components",
      };

      const match = matchSessionToRepository(session, "C:/repo");

      expect(match.matched).toBe(true);
      expect(match.reason).toBe(
        'Working directory is inside repository subdirectory "apps/frontend/src/components".',
      );
    });
  });

  describe("path prefix collision avoidance", () => {
    it("does NOT match when session path shares a prefix but is a different directory", () => {
      // /work/app vs /work/application
      const session: NormalizedSessionSummary = {
        id: "sess-prefix",
        agent: "claude",
        projectPath: "/work/application",
      };

      const match = matchSessionToRepository(session, "/work/app");

      expect(match.matched).toBe(false);
      expect(match.reason).toBe("Working directory is outside repository.");
      expect(match.repoRoot).toBe("/work/app");
      expect(match.sessionPath).toBe("/work/application");
    });

    it("does NOT match Windows similar prefix directories", () => {
      // C:\repo vs C:\repository_backup
      const session: NormalizedSessionSummary = {
        id: "sess-win-prefix",
        agent: "claude",
        projectPath: "C:\\repository_backup",
      };

      const match = matchSessionToRepository(session, "C:\\repo");

      expect(match.matched).toBe(false);
      expect(match.reason).toBe("Working directory is outside repository.");
    });
  });

  describe("unrelated and ancestor directories", () => {
    it("does NOT match an entirely unrelated directory", () => {
      const session: NormalizedSessionSummary = {
        id: "sess-unrelated",
        agent: "claude",
        projectPath: "/other/workspace/project",
      };

      const match = matchSessionToRepository(session, "/work/my-project");

      expect(match.matched).toBe(false);
      expect(match.reason).toBe("Working directory is outside repository.");
    });

    it("does NOT match when session is an ancestor of repository root", () => {
      const session: NormalizedSessionSummary = {
        id: "sess-ancestor",
        agent: "claude",
        projectPath: "/work",
      };

      const match = matchSessionToRepository(session, "/work/my-project");

      expect(match.matched).toBe(false);
      expect(match.reason).toBe("Working directory is outside repository.");
    });

    it("does NOT match different Windows drive letters", () => {
      const session: NormalizedSessionSummary = {
        id: "sess-drive",
        agent: "claude",
        projectPath: "D:/project",
      };

      const match = matchSessionToRepository(session, "C:/project");

      expect(match.matched).toBe(false);
      expect(match.reason).toBe("Working directory is outside repository.");
    });
  });

  describe("missing or invalid path evidence", () => {
    it("returns matched=false when session has undefined projectPath and repoRoot", () => {
      const session: NormalizedSessionSummary = {
        id: "sess-no-path",
        agent: "claude",
      };

      const match = matchSessionToRepository(session, "/work/my-project");

      expect(match.matched).toBe(false);
      expect(match.reason).toBe(
        "Session has no working directory or project path evidence.",
      );
      expect(match.repoRoot).toBe("/work/my-project");
      expect(match.sessionPath).toBeUndefined();
    });

    it("returns matched=false when session projectPath is empty or whitespace", () => {
      const session: NormalizedSessionSummary = {
        id: "sess-empty-path",
        agent: "claude",
        projectPath: "   ",
      };

      const match = matchSessionToRepository(session, "/work/my-project");

      expect(match.matched).toBe(false);
      expect(match.reason).toBe(
        "Session has no working directory or project path evidence.",
      );
    });

    it("returns matched=false when repoRoot is empty without throwing", () => {
      const session: NormalizedSessionSummary = {
        id: "sess-1",
        agent: "claude",
        projectPath: "/work/my-project",
      };

      const match = matchSessionToRepository(session, "");

      expect(match.matched).toBe(false);
      expect(match.reason).toBe("Repository root path is required.");
      expect(match.repoRoot).toBe("");
    });

    it("rejects repoRoot '.' and does not match arbitrary absolute session paths", () => {
      const session: NormalizedSessionSummary = {
        id: "sess-abs",
        agent: "claude",
        projectPath: "/work/my-project",
      };

      const match = matchSessionToRepository(session, ".");

      expect(match.matched).toBe(false);
      expect(match.reason).toBe("Repository root path is invalid.");
    });

    it("rejects repoRoot 'foo/..' and does not become a universal '/' prefix match", () => {
      const session: NormalizedSessionSummary = {
        id: "sess-abs-2",
        agent: "claude",
        projectPath: "/work/my-project",
      };

      const match = matchSessionToRepository(session, "foo/..");

      expect(match.matched).toBe(false);
      expect(match.reason).toBe("Repository root path is invalid.");
    });

    it("rejects relative repoRoot paths without throwing", () => {
      const session: NormalizedSessionSummary = {
        id: "sess-rel",
        agent: "claude",
        projectPath: "/work/my-project",
      };

      const matchDotDot = matchSessionToRepository(session, "..");
      expect(matchDotDot.matched).toBe(false);
      expect(matchDotDot.reason).toBe("Repository root path is invalid.");

      const matchRel = matchSessionToRepository(session, "some/relative/path");
      expect(matchRel.matched).toBe(false);
      expect(matchRel.reason).toBe("Repository root path is invalid.");
    });

    it("falls back to session.repoRoot when session.projectPath is undefined", () => {
      const session: NormalizedSession = {
        id: "sess-reporoot-fallback",
        agent: "claude",
        repoRoot: "/work/my-project",
        events: [],
      };

      const match = matchSessionToRepository(session, "/work/my-project");

      expect(match.matched).toBe(true);
      expect(match.reason).toBe("Working directory exactly matches repository root.");
      expect(match.sessionPath).toBe("/work/my-project");
    });
  });

  describe("normalization resilience", () => {
    it("handles trailing slashes on repoRoot and session path", () => {
      const session: NormalizedSessionSummary = {
        id: "sess-slash",
        agent: "claude",
        projectPath: "/work/my-project/",
      };

      const match = matchSessionToRepository(session, "/work/my-project///");

      expect(match.matched).toBe(true);
      expect(match.reason).toBe("Working directory exactly matches repository root.");
      expect(match.repoRoot).toBe("/work/my-project");
      expect(match.sessionPath).toBe("/work/my-project");
    });

    it("handles relative segments . and .. in session path", () => {
      const session: NormalizedSessionSummary = {
        id: "sess-dots",
        agent: "claude",
        projectPath: "/work/my-project/packages/core/../web",
      };

      const match = matchSessionToRepository(session, "/work/my-project");

      expect(match.matched).toBe(true);
      expect(match.reason).toBe(
        'Working directory is inside repository subdirectory "packages/web".',
      );
      expect(match.sessionPath).toBe("/work/my-project/packages/web");
    });

    it("handles Windows backslashes in both repoRoot and session path", () => {
      const session: NormalizedSessionSummary = {
        id: "sess-bs",
        agent: "claude",
        projectPath: "C:\\work\\my-project\\src",
      };

      const match = matchSessionToRepository(session, "C:\\work\\my-project");

      expect(match.matched).toBe(true);
      expect(match.reason).toBe(
        'Working directory is inside repository subdirectory "src".',
      );
      expect(match.repoRoot).toBe("C:/work/my-project");
      expect(match.sessionPath).toBe("C:/work/my-project/src");
    });

    it("handles Windows drive letter and path case-insensitivity", () => {
      const session: NormalizedSessionSummary = {
        id: "sess-case",
        agent: "claude",
        projectPath: "c:/Work/My-Project/Packages/Web",
      };

      const match = matchSessionToRepository(session, "C:/work/my-project");

      expect(match.matched).toBe(true);
      expect(match.reason).toBe(
        'Working directory is inside repository subdirectory "Packages/Web".',
      );
    });
  });

  describe("Windows UNC paths", () => {
    it("matches exact UNC path", () => {
      const session: NormalizedSessionSummary = {
        id: "sess-unc-exact",
        agent: "claude",
        projectPath: "\\\\server\\share\\repo",
      };

      const match = matchSessionToRepository(session, "\\\\server\\share\\repo");

      expect(match.matched).toBe(true);
      expect(match.reason).toBe("Working directory exactly matches repository root.");
      expect(match.repoRoot).toBe("//server/share/repo");
      expect(match.sessionPath).toBe("//server/share/repo");
    });

    it("matches UNC descendant subdirectory", () => {
      const session: NormalizedSessionSummary = {
        id: "sess-unc-sub",
        agent: "claude",
        projectPath: "\\\\Server\\Share\\Repo\\packages\\web",
      };

      const match = matchSessionToRepository(session, "\\\\server\\share\\repo");

      expect(match.matched).toBe(true);
      expect(match.reason).toBe(
        'Working directory is inside repository subdirectory "packages/web".',
      );
      expect(match.repoRoot).toBe("//server/share/repo");
      expect(match.sessionPath).toBe("//Server/Share/Repo/packages/web");
    });

    it("matches UNC paths using Windows case-insensitive semantics", () => {
      const session: NormalizedSessionSummary = {
        id: "sess-unc-case",
        agent: "claude",
        projectPath: "\\\\SERVER\\SHARE\\REPO",
      };

      const match = matchSessionToRepository(session, "\\\\server\\share\\repo");

      expect(match.matched).toBe(true);
      expect(match.reason).toBe("Working directory exactly matches repository root.");
    });

    it("does NOT match UNC prefix collision", () => {
      // \\server\share\repo vs \\server\share\repository
      const session: NormalizedSessionSummary = {
        id: "sess-unc-prefix",
        agent: "claude",
        projectPath: "\\\\server\\share\\repository",
      };

      const match = matchSessionToRepository(session, "\\\\server\\share\\repo");

      expect(match.matched).toBe(false);
      expect(match.reason).toBe("Working directory is outside repository.");
    });

    it("does NOT treat UNC paths as POSIX paths", () => {
      const session: NormalizedSessionSummary = {
        id: "sess-posix-unc",
        agent: "claude",
        projectPath: "/server/share/repo",
      };

      const match = matchSessionToRepository(session, "\\\\server\\share\\repo");

      expect(match.matched).toBe(false);
      expect(match.reason).toBe("Working directory is outside repository.");
    });

    it("handles UNC path normalization with trailing slashes and .. segments", () => {
      const session: NormalizedSessionSummary = {
        id: "sess-unc-norm",
        agent: "claude",
        projectPath: "\\\\server\\share\\repo\\packages\\core\\..\\web\\",
      };

      const match = matchSessionToRepository(session, "\\\\server\\share\\repo\\");

      expect(match.matched).toBe(true);
      expect(match.reason).toBe(
        'Working directory is inside repository subdirectory "packages/web".',
      );
      expect(match.repoRoot).toBe("//server/share/repo");
      expect(match.sessionPath).toBe("//server/share/repo/packages/web");
    });
  });
});

describe("filterSessionsForRepository", () => {
  it("filters sessions belonging to the repo and preserves input order deterministically", () => {
    const sessions: NormalizedSessionSummary[] = [
      { id: "s-1", agent: "claude", projectPath: "/repo" },
      { id: "s-2", agent: "claude", projectPath: "/other-repo" },
      { id: "s-3", agent: "claude", projectPath: "/repo/packages/cli" },
      { id: "s-4", agent: "claude" }, // no path
      { id: "s-5", agent: "claude", projectPath: "/repo/packages/core" },
      { id: "s-6", agent: "claude", projectPath: "/repository_prefix_collision" },
    ];

    const filtered = filterSessionsForRepository(sessions, "/repo");

    expect(filtered.map((s) => s.id)).toEqual(["s-1", "s-3", "s-5"]);
  });

  it("returns an empty array if no sessions match", () => {
    const sessions: NormalizedSessionSummary[] = [
      { id: "s-1", agent: "claude", projectPath: "/other/a" },
      { id: "s-2", agent: "claude", projectPath: "/other/b" },
    ];

    const filtered = filterSessionsForRepository(sessions, "/target/repo");

    expect(filtered).toEqual([]);
  });
});

describe("matchSessionsToRepository", () => {
  it("pairs each session with its match result while preserving order", () => {
    const sessions: NormalizedSessionSummary[] = [
      { id: "s-1", agent: "claude", projectPath: "/repo" },
      { id: "s-2", agent: "claude", projectPath: "/outside" },
    ];

    const results = matchSessionsToRepository(sessions, "/repo");

    expect(results).toHaveLength(2);
    expect(results[0]?.session.id).toBe("s-1");
    expect(results[0]?.match.matched).toBe(true);
    expect(results[1]?.session.id).toBe("s-2");
    expect(results[1]?.match.matched).toBe(false);
  });
});
