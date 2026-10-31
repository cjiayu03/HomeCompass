"""Opt-in regression checks against a populated scoring database (read-only)."""
import asyncio
import os

import httpx
import pytest

from app.main import app


@pytest.mark.parametrize('distinct_blocks', [False, True])
def test_scored_pages_continue_without_repeated_ids_or_blocks(monkeypatch, distinct_blocks):
    database_url = os.getenv('HOMECOMPASS_TEST_DATABASE_URL')
    if not database_url:
        pytest.skip('Set HOMECOMPASS_TEST_DATABASE_URL to a populated scoring database.')
    monkeypatch.setenv('DATABASE_URL', database_url)

    async def verify():
        async with app.router.lifespan_context(app):
            async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url='http://test') as client:
                criteria = {'limit': 50, 'distinct_blocks': distinct_blocks,
                            'priority_weights': dict.fromkeys(('school', 'childcare', 'care', 'affordability'), 1)}
                first = await client.post('/api/v1/search', json=criteria)
                assert first.status_code == 200
                first = first.json()
                assert first['scoreRankingAvailable'] is True
                assert len(first['items']) == 50 and first['hasMore']
                if distinct_blocks:
                    assert len({(h['town'], h['address']) for h in first['items']}) == 50
                second = await client.post('/api/v1/search', json={**criteria, 'cursor': first['nextCursor']})
                assert second.status_code == 200
                second = second.json()
                assert len(second['items']) == 50
                assert first['total'] == second['total']
                assert {h['id'] for h in first['items']}.isdisjoint(h['id'] for h in second['items'])
                scores = [h['score'] for h in first['items'] + second['items']]
                assert scores == sorted(scores, reverse=True)
                if distinct_blocks:
                    assert len({(h['town'], h['address']) for h in first['items'] + second['items']}) == 100
                    # The selected transaction must be that block's best match,
                    # rather than grouping only the already-paginated records.
                    block = first['items'][0]
                    records = await client.post('/api/v1/search', json={**criteria, 'distinct_blocks': False,
                                                                       'query': block['address'], 'town': block['town']})
                    records.raise_for_status()
                    matches = [h for h in records.json()['items'] if h['address'] == block['address']]
                    assert matches and block['score'] == max(h['score'] for h in matches)
    asyncio.run(verify())
