"""One opt-in end-to-end spatial check using an isolated schema, never app data."""
import asyncio
from datetime import datetime, timezone
import json
import os
from pathlib import Path
from uuid import uuid4

import asyncpg
import httpx
import pytest

from app import main
from app.scoring_evidence import refresh_home_scoring_evidence
from app.sources.data_gov_resources import SOURCES, import_resource


def test_home_flags_use_real_postgis_and_reject_partial_or_failed_sources(monkeypatch):
    dsn = os.getenv('HOMECOMPASS_TEST_DATABASE_URL')
    if not dsn:
        pytest.skip('Set HOMECOMPASS_TEST_DATABASE_URL to run isolated PostGIS fixtures.')

    async def verify():
        connection = await asyncpg.connect(dsn)
        schema = 'elderly_flags_' + uuid4().hex
        await connection.execute(f'CREATE SCHEMA {schema}')
        await connection.execute(f'SET search_path TO {schema},public')
        pool = None
        try:
            for path in sorted((Path(__file__).resolve().parents[2] / 'database/migrations').glob('*.sql')):
                await connection.execute(path.read_text())
            pool = await asyncpg.create_pool(dsn, min_size=1, max_size=2, server_settings={'search_path': f'{schema},public'})
            monkeypatch.setattr(main, 'require_pool', lambda: pool)
            now = datetime.now(timezone.utc)
            polygon = {'type': 'Polygon', 'coordinates': [[[103.8, 1.3], [103.81, 1.3], [103.81, 1.31], [103.8, 1.31], [103.8, 1.3]]]}
            gtp = {'type': 'Point', 'coordinates': [103.805, 1.305]}
            for kind, geometry in [('silver_zone', polygon), ('dementia_gtp', gtp)]:
                source = next(s for s in SOURCES if s.resource_type == kind)
                payload = json.dumps({'type': 'FeatureCollection', 'features': [{'type': 'Feature', 'geometry': geometry, 'properties': {'NAME': kind}}]}).encode()
                await import_resource(pool, source, payload, source_updated_at=now, source_timestamp_verified=True)
            snapshot_id = uuid4()
            await connection.execute("INSERT INTO source_snapshot(id,source_id,status) VALUES($1,'test-hdb','valid')", snapshot_id)
            for home_id, lng, lat in [('inside', 103.805, 1.305), ('boundary', 103.8, 1.305), ('outside', 103.82, 1.305)]:
                await connection.execute("""INSERT INTO candidate_home(id,source_snapshot_id,address,town,flat_type,geometry,geocode_status,geometry_source)
                    VALUES($1,$2,$1,'BISHAN','4 ROOM',ST_SetSRID(ST_MakePoint($3,$4),4326),'resolved','onemap')""", home_id, snapshot_id, lng, lat)
            async with pool.acquire() as conn:
                await refresh_home_scoring_evidence(conn)
            async with httpx.AsyncClient(transport=httpx.ASGITransport(app=main.app), base_url='http://test') as client:
                detail = await client.get('/api/v1/homes/inside')
                assert detail.status_code == 200, detail.text
                flags = detail.json()['elderlyZones']
                assert flags['silverZone']['state'] == 'inside'
                assert flags['dementiaGtp']['state'] == 'nearby'
                assert flags['dementiaGtp']['distanceM'] == 0
                assert flags['silverZone']['sourceUpdatedAt'] is not None
                assert (await client.get('/api/v1/homes/boundary')).json()['elderlyZones']['silverZone']['state'] == 'inside'
                outside = (await client.get('/api/v1/homes/outside')).json()['elderlyZones']
                assert outside['silverZone']['state'] == 'outside'
                assert outside['dementiaGtp']['state'] == 'not_nearby'
                search = await client.post('/api/v1/search', json={})
                assert search.status_code == 200, search.text
                assert len(search.json()['items']) == 3
                assert all('elderlyZones' in home for home in search.json()['items'])
                # A bad shape must be withheld without breaking the home endpoint.
                await connection.execute("UPDATE neighbourhood_resource SET geometry=ST_GeomFromText('POLYGON((103.8 1.3,103.81 1.31,103.81 1.3,103.8 1.31,103.8 1.3))',4326) WHERE resource_type='silver_zone'")
                partial = (await client.get('/api/v1/homes/inside')).json()['elderlyZones']
                assert partial['silverZone']['state'] == 'partial_coverage'
                assert partial['silverZone']['flag'] is None
                assert partial['dementiaGtp']['state'] == 'nearby'
                # Latest failed snapshot must not resurrect old successful evidence.
                await connection.execute("INSERT INTO source_snapshot(id,source_id,status,retrieved_at) VALUES($1,$2,'failed',now()+interval '1 second')", uuid4(), next(s.dataset_id for s in SOURCES if s.resource_type == 'dementia_gtp'))
                unavailable = (await client.get('/api/v1/homes/inside')).json()['elderlyZones']
                assert unavailable['dementiaGtp']['state'] == 'source_unavailable'
        finally:
            if pool:
                await pool.close()
            await connection.execute('RESET search_path')
            await connection.execute(f'DROP SCHEMA {schema} CASCADE')
            await connection.close()
    asyncio.run(verify())
