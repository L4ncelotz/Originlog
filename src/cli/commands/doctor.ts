/**
 * `originlog doctor` command.
 *
 * Fast diagnostic command that verifies whether Originlog can operate in the
 * current environment.
 *
 * Checks:
 * 1. Whether the current directory is inside a Git repository
 * 2. Resolved repository root
 * 3. Available coding-agent adapters through the registry
 * 4. Detection status, session counts, and warnings per adapter
 *
 * Output is clean, non-destructive, read-only, and produces no stack traces.
 */

import { Command } from "commander";
import os from "node:os";
import pc from "picocolors";
import { isGitRepository, getRepoRoot } from "../../git/index.js";
import { detectAgents } from "../../adapters/registry.js";
import type { AdapterContext, DetectedAgent } from "../../adapters/types.js";

/**
 * Diagnostic results for the local Git environment.
 */
export interface GitDiagnostic {
  /** Whether the tested directory is inside a valid Git repository. */
  isRepo: boolean;
  /** Resolved absolute path to the repository root, if available. */
  repoRoot?: string;
}

/**
 * Complete environment diagnostic report.
 */
export interface DoctorReport {
  /** Git environment diagnostic. */
  git: GitDiagnostic;
  /** Probed agent adapters with detection outcomes. */
  agents: DetectedAgent[];
  /** Whether the environment has everything needed for normal operations. */
  ready: boolean;
}

/**
 * Collect a complete diagnostic report without formatting or printing.
 *
 * Safe and read-only. Never throws.
 */
export async function collectDoctorReport(
  context: AdapterContext,
): Promise<DoctorReport> {
  const isRepo = await isGitRepository(context.cwd);
  let resolvedRoot: string | undefined;

  if (isRepo) {
    const root = await getRepoRoot(context.cwd);
    if (root) {
      resolvedRoot = root;
    }
  }

  const effectiveContext: AdapterContext = {
    cwd: context.cwd,
    repoRoot: resolvedRoot ?? context.repoRoot,
    homeDir: context.homeDir,
  };

  const agents = await detectAgents(effectiveContext);

  const hasAnyAgent = agents.some((a) => a.detection.detected);
  const ready = isRepo && hasAnyAgent;

  return {
    git: {
      isRepo,
      repoRoot: resolvedRoot,
    },
    agents,
    ready,
  };
}

/**
 * Format a {@link DoctorReport} into a clean, human-readable terminal string.
 *
 * Supports optional `{ color: false }` for deterministic plain-text output in tests.
 */
export function formatDoctorReport(
  report: DoctorReport,
  options: { color?: boolean } = {},
): string {
  const useColor = options.color ?? true;

  const symbolOk = useColor ? pc.green("✓") : "✓";
  const symbolFail = useColor ? pc.red("✕") : "✕";
  const symbolWarn = useColor ? pc.yellow("!") : "!";

  const lines: string[] = [];

  lines.push("Originlog doctor", "");

  // 1. Git repository check
  if (report.git.isRepo && report.git.repoRoot) {
    lines.push(`${symbolOk} Git repository`);
    const pathText = useColor ? pc.dim(report.git.repoRoot) : report.git.repoRoot;
    lines.push(`  ${pathText}`, "");
  } else if (report.git.isRepo) {
    lines.push(`${symbolOk} Git repository`);
    lines.push("  (repository root unresolved)", "");
  } else {
    lines.push(`${symbolFail} Git repository`);
    const notRepoText = useColor
      ? pc.dim("Not a git repository (run inside a repository to trace changes)")
      : "Not a git repository (run inside a repository to trace changes)";
    lines.push(`  ${notRepoText}`, "");
  }

  // 2. Agents check
  for (const item of report.agents) {
    const { adapter, detection } = item;
    if (detection.detected) {
      lines.push(`${symbolOk} ${adapter.displayName}`);
      const count = detection.sessionCount ?? 0;
      const countMsg =
        count === 1 ? "1 session found" : `${count} sessions found`;
      const sub = useColor ? pc.dim(countMsg) : countMsg;
      lines.push(`  ${sub}`);
    } else {
      lines.push(`${symbolFail} ${adapter.displayName}`);
      const notFoundMsg = "No sessions found";
      const sub = useColor ? pc.dim(notFoundMsg) : notFoundMsg;
      lines.push(`  ${sub}`);
    }

    if (detection.warnings && detection.warnings.length > 0) {
      for (const w of detection.warnings) {
        const warnText = useColor ? pc.yellow(w) : w;
        lines.push(`  ${symbolWarn} ${warnText}`);
      }
    }

    lines.push("");
  }

  // 3. Final readiness summary
  if (report.ready) {
    const readyText = useColor ? pc.bold("Originlog is ready.") : "Originlog is ready.";
    lines.push(readyText);
  } else {
    const reasons: string[] = [];
    if (!report.git.isRepo) {
      reasons.push("current directory is not inside a Git repository");
    }
    const hasAgent = report.agents.some((a) => a.detection.detected);
    if (!hasAgent) {
      reasons.push("no coding agent data found");
    }

    const failureText = `Originlog is not ready: ${reasons.join(", ")}.`;
    lines.push(useColor ? pc.red(failureText) : failureText);
  }

  return lines.join("\n");
}

/**
 * Register the `doctor` command on a Commander {@link Command} instance.
 */
export function registerDoctorCommand(cmd: Command): void {
  cmd
    .command("doctor")
    .description("Verify whether Originlog can operate in the current environment")
    .action(async () => {
      const context: AdapterContext = {
        cwd: process.cwd(),
        homeDir: os.homedir(),
      };
      const report = await collectDoctorReport(context);
      const output = formatDoctorReport(report);
      console.log(output);
      if (!report.ready) {
        process.exitCode = 1;
      }
    });
}
