import { spawn } from "node:child_process";
import { resolve } from "node:path";

const env = { ...process.env, PYTHONPATH: resolve("backend") };
const children = [
  spawn(
    resolve(".venv/bin/python"),
    [
      "-m",
      "uvicorn",
      "app.main:app",
      "--host",
      "127.0.0.1",
      "--port",
      "18080",
      "--no-access-log",
    ],
    { env, stdio: "inherit" },
  ),
  spawn(resolve(".venv/bin/python"), ["-m", "app.worker"], {
    env,
    stdio: "inherit",
  }),
  spawn("npm", ["run", "dev", "--workspace", "frontend"], {
    env,
    stdio: "inherit",
  }),
];
let stopping = false;
function stop() {
  if (stopping) return;
  stopping = true;
  for (const p of children) p.kill("SIGTERM");
}
for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, stop);
for (const child of children)
  child.on("exit", (code) => {
    if (code && !stopping) {
      console.error("开发进程退出，正在关闭同组进程。");
      stop();
      process.exitCode = code;
    }
  });
