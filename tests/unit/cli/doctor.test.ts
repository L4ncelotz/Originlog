import { describe, it, expect } from "vitest";
import { promises as fs } from "node:fs";
import path from "node:path";
import { Command } from "commander";
import { program } from "../../../src/cli/program.js";
import {
  collectDoctorReport,
  formatDoctorReport,
  registerDoctorCommand,
  type DoctorReport,
} from "../../../src/cli/commands/doctor.js";
import { withTempRepo, withTempDir } from "../../helpers/temp-repo.js";
import type { AdapterContext } from "../../../src/adapters/types.js";

describe("doctor command registration", () => {
  it("registers doctor subcommand on program", () => {
    const doctorCmd = program.commands.find((c) => c.name() === "doctor");
    expect(doctorCmd).toBeDefined();
    expect(doctorCmd?.description()).toContain("operate in the current environment");
  });

  it("registers on an independent Commander instance", () => {
    const testProgram = new Command();
    registerDoctorCommand(testProgram);
    const cmd = testProgram.commands.find((c) => c.name() === "doctor");
    expect(cmd).toBeDefined();
  });
});

describe("collectDoctorReport", () => {
  it("reports ready=true when inside a Git repo and Claude Code sessions exist", async () => {
    await withTempRepo(async (repoRoot) => {
      const homeDir = path.join(repoRoot, "mock-home");
      const projectsDir = path.join(homeDir, ".claude", "projects", "my-repo");
      await fs.mkdir(projectsDir, { recursive: true });

      // Create a dummy session transcript
      const transcript = JSON.stringify({
        type: "user",
        sessionId: "doc-session-1",
        timestamp: "2026-07-24T10:00:00.000Z",
        cwd: repoRoot,
        promptId: "p-1",
        message: { role: "user", content: "Init project" },
      }) + "\n";
      await fs.writeFile(path.join(projectsDir, "doc-session-1.jsonl"), transcript, "utf8");

      const context: AdapterContext = {
        cwd: repoRoot,
        homeDir,
      };

      const report = await collectDoctorReport(context);

      expect(report.git.isRepo).toBe(true);
      expect(report.git.repoRoot).toBeDefined();
      const norm = (p: string) => p.replace(/\\/g, "/").toLowerCase();
      expect(norm(report.git.repoRoot!)).toBe(norm(repoRoot));

      expect(report.agents).toHaveLength(1);
      expect(report.agents[0]?.adapter.id).toBe("claude");
      expect(report.agents[0]?.detection.detected).toBe(true);
      expect(report.agents[0]?.detection.sessionCount).toBe(1);

      expect(report.ready).toBe(true);
    });
  });

  it("reports ready=false when current directory is not a Git repo", async () => {
    await withTempDir(async (tempDir) => {
      const homeDir = path.join(tempDir, "mock-home");
      const context: AdapterContext = {
        cwd: tempDir,
        homeDir,
      };

      const report = await collectDoctorReport(context);

      expect(report.git.isRepo).toBe(false);
      expect(report.git.repoRoot).toBeUndefined();
      expect(report.ready).toBe(false);
    });
  });

  it("reports ready=false when inside a Git repo but no coding agent data is found", async () => {
    await withTempRepo(async (repoRoot) => {
      const emptyHome = path.join(repoRoot, "empty-home");
      await fs.mkdir(emptyHome, { recursive: true });

      const context: AdapterContext = {
        cwd: repoRoot,
        homeDir: emptyHome,
      };

      const report = await collectDoctorReport(context);

      expect(report.git.isRepo).toBe(true);
      expect(report.git.repoRoot).toBeDefined();

      const claudeAgent = report.agents.find((a) => a.adapter.id === "claude");
      expect(claudeAgent).toBeDefined();
      expect(claudeAgent?.detection.detected).toBe(false);

      expect(report.ready).toBe(false);
    });
  });
});

describe("formatDoctorReport", () => {
  it("formats a fully ready environment with positive status", () => {
    const report: DoctorReport = {
      git: {
        isRepo: true,
        repoRoot: "C:/dev/Originlog",
      },
      agents: [
        {
          adapter: {
            id: "claude",
            displayName: "Claude Code",
            detect: async () => ({ detected: true, sourcePaths: [] }),
            listSessions: async () => [],
            loadSession: async () => { throw new Error(); },
          },
          detection: {
            detected: true,
            sourcePaths: ["C:/Users/dev/.claude/projects/proj"],
            sessionCount: 42,
          },
        },
      ],
      ready: true,
    };

    const text = formatDoctorReport(report, { color: false });

    expect(text).toContain("Originlog doctor");
    expect(text).toContain("✓ Git repository");
    expect(text).toContain("C:/dev/Originlog");
    expect(text).toContain("✓ Claude Code");
    expect(text).toContain("42 sessions found");
    expect(text).toContain("Originlog is ready.");
  });

  it("formats 1 session found correctly in singular form", () => {
    const report: DoctorReport = {
      git: { isRepo: true, repoRoot: "/repo" },
      agents: [
        {
          adapter: {
            id: "claude",
            displayName: "Claude Code",
            detect: async () => ({ detected: true, sourcePaths: [] }),
            listSessions: async () => [],
            loadSession: async () => { throw new Error(); },
          },
          detection: {
            detected: true,
            sourcePaths: ["/path"],
            sessionCount: 1,
          },
        },
      ],
      ready: true,
    };

    const text = formatDoctorReport(report, { color: false });
    expect(text).toContain("1 session found");
  });

  it("formats non-repo failure clearly with actionable guidance", () => {
    const report: DoctorReport = {
      git: {
        isRepo: false,
      },
      agents: [
        {
          adapter: {
            id: "claude",
            displayName: "Claude Code",
            detect: async () => ({ detected: true, sourcePaths: [] }),
            listSessions: async () => [],
            loadSession: async () => { throw new Error(); },
          },
          detection: {
            detected: true,
            sourcePaths: ["/path"],
            sessionCount: 5,
          },
        },
      ],
      ready: false,
    };

    const text = formatDoctorReport(report, { color: false });

    expect(text).toContain("✕ Git repository");
    expect(text).toContain("Not a git repository");
    expect(text).toContain("Originlog is not ready: current directory is not inside a Git repository.");
  });

  it("formats missing agent data failure cleanly", () => {
    const report: DoctorReport = {
      git: {
        isRepo: true,
        repoRoot: "/my/repo",
      },
      agents: [
        {
          adapter: {
            id: "claude",
            displayName: "Claude Code",
            detect: async () => ({ detected: false, sourcePaths: [] }),
            listSessions: async () => [],
            loadSession: async () => { throw new Error(); },
          },
          detection: {
            detected: false,
            sourcePaths: [],
          },
        },
      ],
      ready: false,
    };

    const text = formatDoctorReport(report, { color: false });

    expect(text).toContain("✓ Git repository");
    expect(text).toContain("✕ Claude Code");
    expect(text).toContain("No sessions found");
    expect(text).toContain("Originlog is not ready: no coding agent data found.");
  });

  it("formats warnings cleanly under agent diagnostics without throwing", () => {
    const report: DoctorReport = {
      git: {
        isRepo: true,
        repoRoot: "/my/repo",
      },
      agents: [
        {
          adapter: {
            id: "claude",
            displayName: "Claude Code",
            detect: async () => ({ detected: true, sourcePaths: [] }),
            listSessions: async () => [],
            loadSession: async () => { throw new Error(); },
          },
          detection: {
            detected: true,
            sourcePaths: ["/my/path"],
            sessionCount: 2,
            warnings: [
              "Permission denied reading ~/.claude/projects/secret",
              "Malformed JSON in ~/.claude/history.jsonl line 4",
            ],
          },
        },
      ],
      ready: true,
    };

    const text = formatDoctorReport(report, { color: false });

    expect(text).toContain("! Permission denied reading ~/.claude/projects/secret");
    expect(text).toContain("! Malformed JSON in ~/.claude/history.jsonl line 4");
    expect(text).toContain("Originlog is ready.");
  });
});
