"""Start/migrate this checkout's isolated native PostGIS cluster; never use another DB."""
from __future__ import annotations

import asyncio
import os
from pathlib import Path
import re
import shutil
import subprocess
import tempfile

import asyncpg
from dotenv import dotenv_values

ROOT = Path(__file__).resolve().parents[1]
DATA = ROOT / '.local' / 'postgres'


def run(command, **kwargs):
    result = subprocess.run(command, capture_output=True, text=True, **kwargs)
    if result.returncode:
        raise RuntimeError(f'{Path(command[0]).name} failed. See {DATA / "server.log"} for database startup details.')
    return result


async def main():
    config = dotenv_values(ROOT / '.env')
    user, database = config.get('POSTGRES_USER'), config.get('POSTGRES_DB')
    password, port = config.get('POSTGRES_PASSWORD'), int(config.get('POSTGRES_PORT', '5433'))
    if not password or not all(re.fullmatch(r'[A-Za-z_][A-Za-z0-9_]{0,62}', value or '') for value in (user, database)):
        raise RuntimeError('Set POSTGRES_USER, POSTGRES_DB and POSTGRES_PASSWORD in the private root .env first.')
    if not 1024 <= port <= 65535:
        raise RuntimeError('Use a private local database port from 1024 to 65535.')
    pg_config = shutil.which('pg_config')
    if not pg_config:
        raise RuntimeError('Install PostgreSQL and its PostGIS extension before starting the native database.')
    binaries = Path(run([pg_config, '--bindir']).stdout.strip())
    DATA.parent.mkdir(parents=True, exist_ok=True)
    created = not (DATA / 'PG_VERSION').exists()
    if created:
        with tempfile.NamedTemporaryFile(mode='w') as credential:
            os.chmod(credential.name, 0o600)
            credential.write(password+'\n')
            credential.flush()
            run([str(binaries/'initdb'), '-D', str(DATA), '--username', user, '--pwfile', credential.name,
                 '--auth-local=scram-sha-256', '--auth-host=scram-sha-256'])
    status = subprocess.run([str(binaries/'pg_ctl'), '-D', str(DATA), 'status'], capture_output=True)
    if status.returncode:
        run([str(binaries/'pg_ctl'), '-D', str(DATA), '-l', str(DATA/'server.log'),
             '-o', f'-h 127.0.0.1 -p {port} -k {DATA}', '-w', 'start'])
    options = dict(host='127.0.0.1', port=port, user=user, password=password)
    connection = await asyncpg.connect(database='postgres', **options)
    try:
        # Refuse migration if the port belongs to another PostgreSQL instance.
        actual = Path(await connection.fetchval('SHOW data_directory')).resolve()
        if actual != DATA.resolve():
            raise RuntimeError('That port belongs to another database cluster. No migrations were applied.')
        exists = await connection.fetchval('SELECT EXISTS(SELECT 1 FROM pg_database WHERE datname=$1)', database)
        if not exists:
            await connection.execute(f'CREATE DATABASE "{database}"')
    finally:
        await connection.close()
    connection = await asyncpg.connect(database=database, **options)
    try:
        for migration in sorted((ROOT/'database'/'migrations').glob('*.sql')):
            await connection.execute(migration.read_text())
    finally:
        await connection.close()
    print(f'Private PostGIS ready on 127.0.0.1:{port}; data stays in .local/postgres.')


if __name__ == '__main__':
    try:
        asyncio.run(main())
    except Exception as error:
        # Avoid printing a connection string, credential or SQL parameters.
        print(f'Native database setup failed ({type(error).__name__}). Check .env and .local/postgres/server.log.')
        raise SystemExit(1) from None
