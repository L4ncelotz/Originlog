import { Command } from "commander";

export const program = new Command();

program
  .name("originlog")
  .description("Know where a code change came from, and why.")
  .version("0.0.1");
