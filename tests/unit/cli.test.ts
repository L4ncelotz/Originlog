import { describe, it, expect } from "vitest";
import { program } from "../../src/cli/program.js";

describe("cli", () => {
  it("program is configured with the correct name", () => {
    expect(program.name()).toBe("originlog");
  });

  it("program has a version", () => {
    expect(program.version()).toBe("0.0.1");
  });

  it("program has a description", () => {
    expect(program.description()).toBe("Know where a code change came from, and why.");
  });
});
