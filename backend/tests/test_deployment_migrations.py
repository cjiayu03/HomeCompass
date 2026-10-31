"""Opt-in integration check for deployment migration transaction boundaries."""
import asyncio
import importlib.util
import os
from pathlib import Path
import sys
from uuid import uuid4

import asyncpg
import pytest


def test_later_migration_failure_rolls_back_wrapped_migrations(tmp_path, monkeypatch):
    database_url = os.getenv('HOMECOMPASS_TEST_DATABASE_URL')
    if not database_url:
        pytest.skip('Set HOMECOMPASS_TEST_DATABASE_URL to run the isolated-schema integration check.')
    script = Path(__file__).resolve().parents[2] / 'ops/tailscale/database.py'
    spec = importlib.util.spec_from_file_location('deployment_database', script)
    deployment = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(deployment)
    migrations = tmp_path / 'release/database/migrations'
    migrations.mkdir(parents=True)
    (migrations / '001_wrapped.sql').write_text('BEGIN; CREATE TABLE rollback_probe (id integer); COMMIT;')
    (migrations / '002_failure.sql').write_text('SELECT 1 / 0;')
    state = tmp_path / 'state'
    (state / 'backups').mkdir(parents=True)
    monkeypatch.setattr(sys, 'argv', [str(script), str(tmp_path / 'release'), str(state)])
    monkeypatch.setattr(deployment, 'dotenv_values', lambda _: {'DATABASE_URL': database_url})

    def backup_stub(args, **kwargs):
        Path(args[args.index('--file') + 1]).touch()
    monkeypatch.setattr(deployment.subprocess, 'run', backup_stub)

    async def verify():
        connection = await asyncpg.connect(database_url)
        schema = 'deployment_rollback_test_' + uuid4().hex
        await connection.execute(f'CREATE SCHEMA {schema}')
        await connection.execute(f'SET search_path TO {schema}')

        class BorrowedConnection:
            def __getattr__(self, name):
                return getattr(connection, name)

            async def close(self):
                pass

        async def borrow_connection(*args, **kwargs):
            return BorrowedConnection()
        monkeypatch.setattr(deployment.asyncpg, 'connect', borrow_connection)
        try:
            with pytest.raises(asyncpg.DivisionByZeroError):
                await deployment.main()
            assert await connection.fetchval("SELECT to_regclass('rollback_probe')") is None
            assert await connection.fetchval("SELECT to_regclass('homecompass_deployment_migration')") is None
        finally:
            await connection.execute('RESET search_path')
            await connection.execute(f'DROP SCHEMA {schema} CASCADE')
            await connection.close()
    asyncio.run(verify())
