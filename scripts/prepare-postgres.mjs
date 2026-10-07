// npm 11 may defer dependency lifecycle scripts. Run only the inspected native
// package's symlink hydration step, from that package's own working directory.
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { spawnSync } from "node:child_process";
const directory = resolve(
  `node_modules/@embedded-postgres/${process.platform}-${process.arch}`,
);
const script = resolve(directory, "scripts/hydrate-symlinks.js");
if (!existsSync(script))
  throw new Error("Current platform package is missing; run npm ci first.");
const result = spawnSync(process.execPath, [script], {
  cwd: directory,
  stdio: "inherit",
});
process.exitCode = result.status ?? 1;
