import { describe, it, expect } from "vitest";
import {
  getAdapters,
  findAdapter,
  detectAgents,
  getDetectedAdapters,
} from "../../../src/adapters/registry.js";
import { claudeAdapter } from "../../../src/adapters/claude/adapter.js";
import type {
  AdapterContext,
  AgentAdapter,
  AgentDetection,
} from "../../../src/adapters/types.js";
function createMockContext(overrides: Partial<AdapterContext> = {}): AdapterContext {
  return {
    cwd: "/mock/project",
    repoRoot: "/mock/project",
    homeDir: "/mock/home",
    ...overrides,
  };
}

function createMockAdapter(
  id: string,
  displayName: string,
  detectImpl?: (context: AdapterContext) => Promise<AgentDetection>,
): AgentAdapter {
  return {
    id,
    displayName,
    detect:
      detectImpl ??
      (async () => ({
        detected: false,
        sourcePaths: [],
      })),
    listSessions: async () => [],
    loadSession: async () => {
      throw new Error("Not implemented in mock");
    },
  };
}

describe("getAdapters", () => {
  it("returns registered adapters in canonical deterministic order", () => {
    const adapters = getAdapters();
    expect(adapters).toHaveLength(1);
    expect(adapters[0]?.id).toBe("claude");
    expect(adapters[0]?.displayName).toBe("Claude Code");
    expect(adapters[0]).toBe(claudeAdapter);
  });

  it("returns a new array copy on each call to prevent mutation leaks", () => {
    const a1 = getAdapters();
    const a2 = getAdapters();
    expect(a1).not.toBe(a2);
    expect(a1).toEqual(a2);

    // Mutating a1 does not affect subsequent calls
    a1.pop();
    expect(a1).toHaveLength(0);
    expect(getAdapters()).toHaveLength(1);
  });
});

describe("findAdapter", () => {
  it("finds the Claude adapter by exact id", () => {
    const adapter = findAdapter("claude");
    expect(adapter).toBeDefined();
    expect(adapter?.id).toBe("claude");
    expect(adapter).toBe(claudeAdapter);
  });

  it("finds the Claude adapter case-insensitively", () => {
    expect(findAdapter("Claude")?.id).toBe("claude");
    expect(findAdapter("CLAUDE")?.id).toBe("claude");
    expect(findAdapter("  claude  ")?.id).toBe("claude");
  });

  it("returns undefined for unknown or uninstalled adapters", () => {
    expect(findAdapter("codex")).toBeUndefined();
    expect(findAdapter("opencode")).toBeUndefined();
    expect(findAdapter("nonexistent")).toBeUndefined();
  });

  it("returns undefined for empty, whitespace, or invalid id inputs", () => {
    expect(findAdapter("")).toBeUndefined();
    expect(findAdapter("   ")).toBeUndefined();
    // @ts-expect-error testing invalid runtime input
    expect(findAdapter(null)).toBeUndefined();
    // @ts-expect-error testing invalid runtime input
    expect(findAdapter(undefined)).toBeUndefined();
  });

  it("finds adapter in custom adapter list when supplied", () => {
    const mockCodex = createMockAdapter("codex", "Codex Agent");
    const customList = [claudeAdapter, mockCodex];

    expect(findAdapter("codex", customList)).toBe(mockCodex);
    expect(findAdapter("CODEX", customList)).toBe(mockCodex);
    expect(findAdapter("claude", customList)).toBe(claudeAdapter);
    expect(findAdapter("other", customList)).toBeUndefined();
  });
});

describe("detectAgents", () => {
  it("probes registered adapters and returns DetectedAgent results in deterministic order", async () => {
    const context = createMockContext();
    const results = await detectAgents(context);

    expect(results).toHaveLength(1);
    expect(results[0]?.adapter.id).toBe("claude");
    expect(results[0]?.detection).toBeDefined();
    expect(typeof results[0]?.detection.detected).toBe("boolean");
    expect(Array.isArray(results[0]?.detection.sourcePaths)).toBe(true);
  });

  it("isolates detection failures: a throwing adapter does not crash discovery of others", async () => {
    const context = createMockContext();

    const normalBefore = createMockAdapter("normal-1", "Normal Before", async () => ({
      detected: true,
      sourcePaths: ["/path/normal-1"],
      sessionCount: 5,
    }));

    const throwingAdapter = createMockAdapter("crasher", "Crasher Agent", async () => {
      throw new Error("Filesystem permission denied / disk I/O error");
    });

    const normalAfter = createMockAdapter("normal-2", "Normal After", async () => ({
      detected: true,
      sourcePaths: ["/path/normal-2"],
      sessionCount: 12,
    }));

    const testAdapters = [normalBefore, throwingAdapter, normalAfter];

    // Running detectAgents must not throw or reject
    const results = await detectAgents(context, testAdapters);

    expect(results).toHaveLength(3);

    // First adapter succeeded
    expect(results[0]?.adapter.id).toBe("normal-1");
    expect(results[0]?.detection.detected).toBe(true);
    expect(results[0]?.detection.sourcePaths).toEqual(["/path/normal-1"]);
    expect(results[0]?.detection.sessionCount).toBe(5);

    // Second adapter threw error, but was captured safely as a warning
    expect(results[1]?.adapter.id).toBe("crasher");
    expect(results[1]?.detection.detected).toBe(false);
    expect(results[1]?.detection.sourcePaths).toEqual([]);
    expect(results[1]?.detection.warnings).toBeDefined();
    expect(results[1]?.detection.warnings?.[0]).toContain(
      "Filesystem permission denied / disk I/O error",
    );

    // Third adapter still executed and succeeded
    expect(results[2]?.adapter.id).toBe("normal-2");
    expect(results[2]?.detection.detected).toBe(true);
    expect(results[2]?.detection.sourcePaths).toEqual(["/path/normal-2"]);
    expect(results[2]?.detection.sessionCount).toBe(12);
  });
});

describe("getDetectedAdapters", () => {
  it("filters to only adapters that detected session data in the environment", async () => {
    const context = createMockContext();

    const activeAdapter = createMockAdapter("active", "Active", async () => ({
      detected: true,
      sourcePaths: ["/active/path"],
    }));

    const inactiveAdapter = createMockAdapter("inactive", "Inactive", async () => ({
      detected: false,
      sourcePaths: [],
    }));

    const failingAdapter = createMockAdapter("failing", "Failing", async () => {
      throw new Error("Broken");
    });

    const customList = [inactiveAdapter, activeAdapter, failingAdapter];

    const detected = await getDetectedAdapters(context, customList);
    expect(detected).toHaveLength(1);
    expect(detected[0]).toBe(activeAdapter);
  });

  it("returns an empty array when no adapters detect session data", async () => {
    const context = createMockContext();

    const inactive1 = createMockAdapter("a1", "A1", async () => ({
      detected: false,
      sourcePaths: [],
    }));
    const inactive2 = createMockAdapter("a2", "A2", async () => ({
      detected: false,
      sourcePaths: [],
    }));

    const detected = await getDetectedAdapters(context, [inactive1, inactive2]);
    expect(detected).toEqual([]);
  });
});
