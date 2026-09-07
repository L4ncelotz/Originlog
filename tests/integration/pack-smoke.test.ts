import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { execa } from "execa";
import { promises as fs } from "node:fs";
import path from "node:path";
import os from "node:os";

describe("npm package smoke test", () => {
  let tempDir: string;
  let consumerDir: string;
  let binPath: string;

  beforeAll(async () => {
    // 1. Ensure build is fresh
    await execa("npm", ["run", "build"]);

    // 2. Create isolated sandbox directory
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "originlog-smoke-"));

    // 3. Pack the package tarball
    const packResult = await execa("npm", ["pack", "--pack-destination", tempDir]);
    const tarballName = packResult.stdout.trim().split(/\r?\n/).pop()!;
    const tarballPath = path.join(tempDir, tarballName);

    // 4. Create an isolated consumer project
    consumerDir = path.join(tempDir, "consumer");
    await fs.mkdir(consumerDir, { recursive: true });
    await fs.writeFile(
      path.join(consumerDir, "package.json"),
      JSON.stringify({
        name: "test-consumer",
        type: "module",
        private: true,
      }),
      "utf8",
    );

    // 5. Install the packed tarball into the consumer project
    await execa("npm", ["install", tarballPath], { cwd: consumerDir });

    binPath = path.join(consumerDir, "node_modules", ".bin", "originlog");
  }, 90000);

  afterAll(async () => {
    if (tempDir) {
      await fs.rm(tempDir, { recursive: true, force: true });
    }
  });

  describe("package manifest and contents", () => {
    it("includes required binary and entry point files in npm pack manifest", async () => {
      const result = await execa("npm", ["pack", "--dry-run", "--json"]);
      const [packInfo] = JSON.parse(result.stdout) as Array<{
        name: string;
        version: string;
        files: Array<{ path: string }>;
      }>;

      expect(packInfo).toBeDefined();
      expect(packInfo.name).toBe("originlog");

      const filePaths = packInfo.files.map((f) => f.path);
      expect(filePaths).toContain("dist/cli.js");
      expect(filePaths).toContain("dist/index.js");
      expect(filePaths).toContain("package.json");
      expect(filePaths).toContain("README.md");
    });

    it("defines the originlog bin entry point in package.json", async () => {
      const pkgContent = await fs.readFile(
        path.join(consumerDir, "node_modules", "originlog", "package.json"),
        "utf8",
      );
      const pkg = JSON.parse(pkgContent);

      expect(pkg.bin).toBeDefined();
      expect(pkg.bin.originlog).toBe("dist/cli.js");
      expect(pkg.main).toBe("dist/index.js");
    });
  });

  describe("CLI commands execution from packed package", () => {
    it("runs originlog --help successfully", async () => {
      const result = await execa(binPath, ["--help"], { cwd: consumerDir });

      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain("Usage: originlog");
      expect(result.stdout).toContain("doctor");
      expect(result.stdout).toContain("sessions");
      expect(result.stdout).toContain("show");
    });

    it("runs originlog --version successfully", async () => {
      const result = await execa(binPath, ["--version"], { cwd: consumerDir });

      expect(result.exitCode).toBe(0);
      expect(result.stdout.trim()).toBe("0.0.1");
    });

    it("runs originlog doctor and reports diagnostic status", async () => {
      const result = await execa(binPath, ["doctor"], {
        cwd: consumerDir,
        reject: false,
      });

      expect(result.stdout).toContain("Originlog doctor");
      expect(result.stdout).toContain("Git repository");
    });

    it("runs originlog sessions cleanly", async () => {
      const result = await execa(binPath, ["sessions"], {
        cwd: consumerDir,
        reject: false,
      });

      expect(result.stdout).toContain("Originlog sessions");
    });

    it("runs originlog show and reports missing session without crashing", async () => {
      const result = await execa(binPath, ["show", "nonexistent-session-id"], {
        cwd: consumerDir,
        reject: false,
      });

      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain("Session not found: nonexistent-session-id");
      // Must not contain ugly stack traces
      expect(result.stderr).not.toContain("    at ");
    });
  });

  describe("library imports from packed package", () => {
    it("allows importing core functions from 'originlog' in a consumer project", async () => {
      const testScript = `
        import {
          matchSessionToRepository,
          filterSessionsForRepository,
          getAdapters,
        } from "originlog";

        const adapters = getAdapters();
        if (!Array.isArray(adapters)) throw new Error("getAdapters must return array");
        if (typeof matchSessionToRepository !== "function") throw new Error("missing matchSessionToRepository");
        if (typeof filterSessionsForRepository !== "function") throw new Error("missing filterSessionsForRepository");

        console.log("SMOKE_IMPORT_OK");
      `;

      await fs.writeFile(path.join(consumerDir, "test-import.js"), testScript, "utf8");
      const result = await execa("node", ["test-import.js"], { cwd: consumerDir });

      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain("SMOKE_IMPORT_OK");
    });
  });
});
