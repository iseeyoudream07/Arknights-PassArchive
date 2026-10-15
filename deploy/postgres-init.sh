#!/bin/sh
# Run only during initialization of the project's new, empty PostgreSQL volume.
set -eu
app_password=$(cat /run/secrets/postgres_app_password)
psql --quiet --set ON_ERROR_STOP=1 --username postgres --dbname passarchive <<SQL
CREATE ROLE pass_app LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION PASSWORD '$app_password';
GRANT CONNECT ON DATABASE passarchive TO pass_app;
ALTER SCHEMA public OWNER TO pass_app;
SQL
unset app_password
