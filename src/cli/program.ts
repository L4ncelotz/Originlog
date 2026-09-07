import { Command } from "commander";
import { registerDoctorCommand } from "./commands/doctor.js";
import { registerSessionsCommand } from "./commands/sessions.js";
import { registerShowCommand } from "./commands/show.js";

export const program = new Command();

program
  .name("originlog")
  .description("Know where a code change came from, and why.")
  .version("0.0.1");
registerDoctorCommand(program);
registerSessionsCommand(program);
registerShowCommand(program);
