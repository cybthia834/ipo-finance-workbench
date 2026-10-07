#!/bin/sh
set -eu
psql -v ON_ERROR_STOP=1 --username postgres --dbname finance <<'SQL'
\getenv owner_pass FINANCE_OWNER_PASSWORD
\getenv app_pass FINANCE_APP_PASSWORD
CREATE ROLE finance_owner LOGIN PASSWORD :'owner_pass' NOSUPERUSER NOCREATEDB NOCREATEROLE;
CREATE ROLE finance_app LOGIN PASSWORD :'app_pass' NOSUPERUSER NOCREATEDB NOCREATEROLE;
ALTER DATABASE finance OWNER TO finance_owner;
REVOKE CREATE ON SCHEMA public FROM PUBLIC;
GRANT ALL ON SCHEMA public TO finance_owner;
SQL
