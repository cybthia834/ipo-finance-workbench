import EmbeddedPostgres from "embedded-postgres";
import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
  appendFileSync,
} from "node:fs";
import { randomBytes } from "node:crypto";
import { resolve } from "node:path";

const runtime = resolve(".runtime/phase1");
mkdirSync(runtime, { recursive: true, mode: 0o700 });
const credentialPath = resolve(runtime, "database.json");
const secrets = existsSync(credentialPath)
  ? JSON.parse(readFileSync(credentialPath, "utf8"))
  : {
      admin: randomBytes(24).toString("hex"),
      owner: randomBytes(24).toString("hex"),
      app: randomBytes(24).toString("hex"),
    };
writeFileSync(credentialPath, JSON.stringify(secrets), { mode: 0o600 });
const pg = new EmbeddedPostgres({
  databaseDir: resolve(runtime, "postgres"),
  user: "postgres",
  password: secrets.admin,
  port: 55434,
  persistent: true,
  authMethod: "scram-sha-256",
  initdbFlags: ["--encoding=UTF8", "--locale=C"],
  postgresFlags: ["-h", "127.0.0.1", "-k", runtime],
  onLog: (message) =>
    appendFileSync(resolve(runtime, "postgres.log"), `${message}\n`),
  onError: () =>
    console.error("PostgreSQL启动错误，请查看 .runtime/phase1/postgres.log"),
});
if (!existsSync(resolve(runtime, "postgres/PG_VERSION"))) await pg.initialise();
// pg_ctl controls this exact data directory, including a new postmaster started
// by a recovery exercise. Do not keep only an in-memory child PID.
const pgctl = resolve(
  `node_modules/@embedded-postgres/${process.platform}-${process.arch}/native/bin/pg_ctl`,
);
const quote = (value) => "'" + value.replaceAll("'", "'\\''") + "'";
function control(action) {
  const args = ["-D", resolve(runtime, "postgres"), "-w", "-t", "30"];
  if (action === "start")
    args.push(
      "-l",
      resolve(runtime, "postgres.log"),
      "-o",
      `-h 127.0.0.1 -p 55434 -k ${quote(runtime)}`,
    );
  else args.push("-m", "fast");
  const result = spawnSync(pgctl, [...args, action], { encoding: "utf8" });
  if (result.status !== 0)
    throw new Error(
      `本项目数据库 ${action} 失败，请检查 .runtime/phase1/postgres.log`,
    );
}
control("start");
const client = pg.getPgClient("postgres", "127.0.0.1");
await client.connect();
for (const [role, password] of [
  ["finance_owner", secrets.owner],
  ["finance_app", secrets.app],
]) {
  const found = await client.query("SELECT 1 FROM pg_roles WHERE rolname=$1", [
    role,
  ]);
  if (!found.rowCount)
    await client.query(
      `CREATE ROLE ${role} LOGIN PASSWORD '${password}' NOSUPERUSER NOCREATEDB NOCREATEROLE`,
    );
}
for (const name of [
  "finance_phase1_dev",
  "finance_phase1_test",
  "finance_phase1_restore",
]) {
  const found = await client.query(
    "SELECT 1 FROM pg_database WHERE datname=$1",
    [name],
  );
  if (!found.rowCount)
    await client.query(`CREATE DATABASE ${name} OWNER finance_owner`);
}
await client.end();
const url = (role, key, db) =>
  `postgresql+psycopg://${role}:${secrets[key]}@127.0.0.1:55434/${db}`;
writeFileSync(
  resolve(runtime, "app.env"),
  [
    "APP_ENV=development",
    "DEMO_MODE=true",
    `DATABASE_URL=${url("finance_app", "app", "finance_phase1_dev")}`,
    `MIGRATION_DATABASE_URL=${url("finance_owner", "owner", "finance_phase1_dev")}`,
    `TEST_DATABASE_URL=${url("finance_app", "app", "finance_phase1_test")}`,
    `TEST_MIGRATION_DATABASE_URL=${url("finance_owner", "owner", "finance_phase1_test")}`,
    `RESTORE_DATABASE_URL=${url("finance_owner", "owner", "finance_phase1_restore")}`,
    "APP_ORIGIN=http://127.0.0.1:5173",
  ].join("\n") + "\n",
  { mode: 0o600 },
);
console.log(
  "本地 PostgreSQL 18 已启动：127.0.0.1:55434。连接配置保存在 .runtime/phase1/app.env。",
);
const keepAlive = setInterval(() => {}, 30000);
let stopping = false;
for (const sig of ["SIGINT", "SIGTERM"])
  process.on(sig, async () => {
    if (stopping) return;
    stopping = true;
    clearInterval(keepAlive);
    control("stop");
    process.exit(0);
  });
