import EmbeddedPostgres from "embedded-postgres";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
  appendFileSync,
} from "node:fs";
import { randomBytes } from "node:crypto";
import { resolve } from "node:path";

const runtime = resolve(".runtime");
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
  port: 55432,
  persistent: true,
  authMethod: "scram-sha-256",
  initdbFlags: ["--encoding=UTF8", "--locale=C"],
  postgresFlags: ["-h", "127.0.0.1", "-k", runtime],
  onLog: (message) =>
    appendFileSync(resolve(runtime, "postgres.log"), `${message}\n`),
  onError: () =>
    console.error("PostgreSQL启动错误，请查看 .runtime/postgres.log"),
});
if (!existsSync(resolve(runtime, "postgres/PG_VERSION"))) await pg.initialise();
await pg.start();
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
for (const name of ["finance_dev", "finance_test", "finance_restore"]) {
  const found = await client.query(
    "SELECT 1 FROM pg_database WHERE datname=$1",
    [name],
  );
  if (!found.rowCount)
    await client.query(`CREATE DATABASE ${name} OWNER finance_owner`);
}
await client.end();
const url = (role, key, db) =>
  `postgresql+psycopg://${role}:${secrets[key]}@127.0.0.1:55432/${db}`;
writeFileSync(
  resolve(runtime, "app.env"),
  [
    "APP_ENV=development",
    "DEMO_MODE=true",
    `DATABASE_URL=${url("finance_app", "app", "finance_dev")}`,
    `MIGRATION_DATABASE_URL=${url("finance_owner", "owner", "finance_dev")}`,
    `TEST_DATABASE_URL=${url("finance_app", "app", "finance_test")}`,
    `TEST_MIGRATION_DATABASE_URL=${url("finance_owner", "owner", "finance_test")}`,
    `RESTORE_DATABASE_URL=${url("finance_owner", "owner", "finance_restore")}`,
    "APP_ORIGIN=http://127.0.0.1:5173",
  ].join("\n") + "\n",
  { mode: 0o600 },
);
console.log(
  "本地 PostgreSQL 18 已启动：127.0.0.1:55432。连接配置保存在 .runtime/app.env。",
);
const keepAlive = setInterval(() => {}, 30000);
let stopping = false;
for (const sig of ["SIGINT", "SIGTERM"])
  process.on(sig, async () => {
    if (stopping) return;
    stopping = true;
    clearInterval(keepAlive);
    await pg.stop();
    process.exit(0);
  });
