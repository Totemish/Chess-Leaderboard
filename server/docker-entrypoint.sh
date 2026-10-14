#!/bin/sh
# Container start: apply any new database migrations, then run the API.
# `exec` hands PID 1 to Node so it receives SIGTERM and shuts down cleanly.
set -e

if ! npx prisma migrate deploy; then
  echo "Database migrations failed." >&2
  echo "If this database was created before migrations existed (error P3005), run this once" >&2
  echo "from server/ on your computer, then redeploy:  npx prisma migrate resolve --applied 0_init" >&2
  exit 1
fi

exec node dist/index.js
