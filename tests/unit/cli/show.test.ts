import { describe, it, expect } from "vitest";
import { Command } from "commander";
import { program } from "../../../src/cli/program.js";
import {
  resolveSession,
  registerShowCommand,
} from "../../../src/cli/commands/show.js";
import type { AgentAdapter, AdapterContext } from "../../../src/adapters/types.js";
import type { NormalizedSession } from "../../../src/core/sessions.js";

describe("show command registration", () => {
  it("registers show subcommand on the main program", () => {
    const showCmd = program.commands.find((c) => c.name() === "show");
    expect(showCmd).toBeDefined();
    expect(showCmd?.description()).toContain("timeline for one coding-agent session");
  });

  it("registers on an independent Commander instance", () => {
    const testProgram = new Command();
    registerShowCommand(testProgram);
    const cmd = testProgram.commands.find((c) => c.name() === "show");
    expect(cmd).toBeDefined();
  });
});

describe("resolveSession", () => {
  const dummyContext: AdapterContext = {
    cwd: "/mock/cwd",
    homeDir: "/mock/home",
  };

  const mockSessionFull: NormalizedSession = {
    id: "a84f29c1-4567-489a-bcde-1234567890ab",
    agent: "Claude Code",
    projectPath: "/mock/cwd",
    events: [
      {
        id: "e1",
        sessionId: "a84f29c1-4567-489a-bcde-1234567890ab",
        type: "prompt",
        content: "Fix token validation",
      },
    ],
  };

  it("loads directly when exact full ID matches", async () => {
    const adapter: AgentAdapter = {
      id: "claude",
      displayName: "Claude Code",
      detect: async () => ({ detected: true, sourcePaths: [] }),
      listSessions: async () => [
        { id: mockSessionFull.id, agent: "claude" },
      ],
      loadSession: async (id) => {
        if (id === mockSessionFull.id) return mockSessionFull;
        throw new Error("Not found");
      },
    };

    const result = await resolveSession(mockSessionFull.id, dummyContext, {
      adapters: [adapter],
    });

    expect(result.session.id).toBe(mockSessionFull.id);
    expect(result.adapter.id).toBe("claude");
  });

  it("resolves by unique prefix when shortened ID is provided", async () => {
    const adapter: AgentAdapter = {
      id: "claude",
      displayName: "Claude Code",
      detect: async () => ({ detected: true, sourcePaths: [] }),
      listSessions: async () => [
        { id: mockSessionFull.id, agent: "claude" },
        { id: "different-session-id", agent: "claude" },
      ],
      loadSession: async (id) => {
        if (id === mockSessionFull.id) return mockSessionFull;
        throw new Error("Not found");
      },
    };

    // User provides only first 8 characters
    const result = await resolveSession("a84f29c1", dummyContext, {
      adapters: [adapter],
    });

    expect(result.session.id).toBe(mockSessionFull.id);
    expect(result.session.events).toHaveLength(1);
  });

  it("throws clean error when prefix matches multiple candidate sessions (ambiguity)", async () => {
    const adapter: AgentAdapter = {
      id: "claude",
      displayName: "Claude Code",
      detect: async () => ({ detected: true, sourcePaths: [] }),
      listSessions: async () => [
        { id: "a84f29c1-1111-489a-bcde-1234567890ab", agent: "claude" },
        { id: "a84f29c1-2222-489a-bcde-1234567890ab", agent: "claude" },
      ],
      loadSession: async () => {
        throw new Error("Direct load failed");
      },
    };

    await expect(
      resolveSession("a84f29c1", dummyContext, { adapters: [adapter] }),
    ).rejects.toThrowError(/Ambiguous session ID "a84f29c1": matches multiple sessions:/);
  });

  it("throws clean error when session is not found", async () => {
    const adapter: AgentAdapter = {
      id: "claude",
      displayName: "Claude Code",
      detect: async () => ({ detected: true, sourcePaths: [] }),
      listSessions: async () => [],
      loadSession: async () => {
        throw new Error("Not found");
      },
    };

    await expect(
      resolveSession("non-existent-session", dummyContext, { adapters: [adapter] }),
    ).rejects.toThrowError('Session not found: non-existent-session');
  });

  it("resolves across multiple adapters in an agent-agnostic way", async () => {
    const claudeSession: NormalizedSession = {
      id: "claude-sess-1",
      agent: "Claude Code",
      events: [],
    };
    const codexSession: NormalizedSession = {
      id: "codex-sess-1",
      agent: "Codex Agent",
      events: [],
    };

    const claudeAdapter: AgentAdapter = {
      id: "claude",
      displayName: "Claude Code",
      detect: async () => ({ detected: true, sourcePaths: [] }),
      listSessions: async () => [{ id: "claude-sess-1", agent: "claude" }],
      loadSession: async (id) => {
        if (id === "claude-sess-1") return claudeSession;
        throw new Error("Not found");
      },
    };

    const codexAdapter: AgentAdapter = {
      id: "codex",
      displayName: "Codex Agent",
      detect: async () => ({ detected: true, sourcePaths: [] }),
      listSessions: async () => [{ id: "codex-sess-1", agent: "codex" }],
      loadSession: async (id) => {
        if (id === "codex-sess-1") return codexSession;
        throw new Error("Not found");
      },
    };

    const result = await resolveSession("codex-sess", dummyContext, {
      adapters: [claudeAdapter, codexAdapter],
    });

    expect(result.session.id).toBe("codex-sess-1");
    expect(result.adapter.id).toBe("codex");
  });

  it("rejects empty or whitespace sessionId", async () => {
    await expect(resolveSession("", dummyContext)).rejects.toThrowError(
      "Session ID is required.",
    );
    await expect(resolveSession("   ", dummyContext)).rejects.toThrowError(
      "Session ID is required.",
    );
  });
});
