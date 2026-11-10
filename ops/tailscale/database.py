"""Back up the configured app DB, then apply checked-in migrations transactionally."""
import asyncio
import hashlib
import os
from pathlib import Path
import re
import subprocess
import sys
from datetime import datetime, timezone
from urllib.parse import unquote, urlsplit

import asyncpg
from dotenv import dotenv_values


async def main():
    release, state = map(Path, sys.argv[1:3])
    config = dotenv_values(state / 'runtime.env')
    url = config['DATABASE_URL']
    parts = urlsplit(url)
    if parts.hostname != '127.0.0.1' or parts.port != 55434 or parts.path != '/softwarelab':
        raise RuntimeError('Refusing to migrate a database other than the softwarelab deployment database.')
    backup = state / 'backups' / (datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%S%fZ') + '.dump')
    subprocess.run([
        'pg_dump', '--host', parts.hostname, '--port', str(parts.port),
        '--username', unquote(parts.username), '--dbname', parts.path[1:],
        '--format=custom', '--no-owner', '--file', str(backup),
    ], env={**os.environ, 'PGPASSWORD': unquote(parts.password)}, check=True)
    backup.chmod(0o600)
    connection = await asyncpg.connect(url, command_timeout=180)
    try:
        async with connection.transaction():
            await connection.execute('CREATE TABLE IF NOT EXISTS homecompass_deployment_migration (name text PRIMARY KEY, checksum text NOT NULL, applied_at timestamptz NOT NULL DEFAULT now())')
            for migration in sorted((release / 'database' / 'migrations').glob('*.sql')):
                sql = migration.read_text()
                checksum = hashlib.sha256(sql.encode()).hexdigest()
                previous = await connection.fetchval('SELECT checksum FROM homecompass_deployment_migration WHERE name=$1', migration.name)
                if previous is not None:
                    if previous != checksum:
                        raise RuntimeError('An applied migration was edited; append a new migration instead.')
                    continue
                # The runner owns the transaction; standalone script wrappers
                # must not commit this release's schema changes or ledger early.
                wrapped = re.fullmatch(r'\s*BEGIN\s*;(.*)\bCOMMIT\s*;\s*', sql, re.IGNORECASE | re.DOTALL)
                await connection.execute(wrapped.group(1) if wrapped else sql)
                await connection.execute('INSERT INTO homecompass_deployment_migration(name,checksum) VALUES($1,$2)', migration.name, checksum)
    finally:
        await connection.close()
    print('Database backup complete; migrations committed.', flush=True)


if __name__ == '__main__':
    try:
        asyncio.run(main())
    except Exception as error:
        print('Database deployment failed (' + type(error).__name__ + '); credentials omitted.', file=sys.stderr)
        raise SystemExit(1)
