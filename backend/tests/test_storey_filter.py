import asyncio
import os

import asyncpg
import httpx
import pytest

from app import main
from app.saved_searches import _saved_place_constraints
from app.schemas import SearchRequest


class QueryProbe:
    def __init__(self):
        self.counts = []
        self.pages = []

    def acquire(self):
        return self

    async def __aenter__(self):
        return self

    async def __aexit__(self, *_args):
        return None

    async def fetchrow(self, sql, *values):
        if "count(*) AS total" in sql and "FROM candidate_home h" in sql:
            self.counts.append((sql, values))
            return {"total": 0}
        if "geocoded" in sql and "FROM candidate_home" in sql:
            return {"total": 0, "geocoded": 0}
        if "FROM neighbourhood_resource" in sql:
            return {"schools": 0, "childcare": 0, "care": 0}
        raise AssertionError(f"Unexpected query: {sql}")

    async def fetch(self, sql, *values):
        if "FROM page_homes h JOIN source_snapshot" in sql:
            self.pages.append((sql, values))
            return []
        raise AssertionError(f"Unexpected query: {sql}")


def test_storey_predicates_use_bounded_guarded_casts_and_parameter_offsets():
    values = ["existing-value"]
    parts = main._storey_overlap_predicates(
        SearchRequest(min_storey=5, max_storey=8), values
    )

    assert values == ["existing-value", 5, 8]
    assert len(parts) == 3
    assert "BETWEEN 1 AND" in parts[0]
    assert "CASE WHEN" in parts[0] and "::integer" in parts[0]
    assert "^[0-9]{1,3} +TO +[0-9]{1,3}$" in parts[0]
    assert "!~ '[^0-9 TO]'" in parts[0]
    assert "FROM '[0-9]{1,3}$'" in parts[1] and parts[1].endswith(">= $2")
    assert "FROM '^[0-9]{1,3}'" in parts[2] and parts[2].endswith("<= $3")


@pytest.mark.parametrize("payload, expected", [
    ({}, []),
    ({"min_storey": 5}, [5]),
    ({"max_storey": 8}, [8]),
])
def test_storey_predicates_handle_optional_bounds(payload, expected):
    values = []
    parts = main._storey_overlap_predicates(SearchRequest(**payload), values)
    assert values == expected
    assert len(parts) == (2 if expected else 0)


def test_saved_search_replay_preserves_storey_bounds_for_current_search():
    _, criteria = _saved_place_constraints({
        "criteria": {"query": "Bishan", "min_storey": 5, "max_storey": 8},
        "place_constraints": [],
    })
    values = []
    predicates = main._storey_overlap_predicates(criteria, values)
    assert values == [5, 8]
    assert len(predicates) == 3
    assert criteria.cursor is None


def test_get_and_post_share_storey_predicates_before_count_and_page(monkeypatch):
    probe = QueryProbe()
    monkeypatch.setattr(main, "require_pool", lambda: probe)

    async def requests():
        async with httpx.AsyncClient(
            transport=httpx.ASGITransport(app=main.app), base_url="http://test"
        ) as client:
            return [
                await client.get("/api/v1/homes", params={"min_storey": 5, "max_storey": 8, "limit": 2}),
                await client.post("/api/v1/search", json={"min_storey": 5, "max_storey": 8, "limit": 2}),
                await client.get("/api/v1/homes", params={"min_storey": 9, "max_storey": 5}),
                await client.post("/api/v1/search", json={"min_storey": 0}),
            ]

    responses = asyncio.run(requests())
    assert [response.status_code for response in responses] == [200, 200, 422, 422]
    for response in responses[:2]:
        assert response.json()["total"] == 0
        assert response.json()["items"] == []
    assert len(probe.counts) == len(probe.pages) == 2
    parts = main._storey_overlap_predicates(SearchRequest(min_storey=5, max_storey=8), [])
    for (count_sql, count_values), (page_sql, page_values) in zip(probe.counts, probe.pages):
        assert count_values == (5, 8)
        assert page_values[:2] == (5, 8)
        assert page_values[-1] == 3
        assert all(part in count_sql and part in page_sql for part in parts)
        assert page_sql.index(parts[0]) < page_sql.index("ORDER BY ranking_score DESC NULLS LAST")


# Set this only to an isolated PostgreSQL test database; no schema or table is changed.
TEST_POSTGRES_DSN = os.environ.get("HOMECOMPASS_TEST_POSTGRES_URL")


@pytest.mark.skipif(not TEST_POSTGRES_DSN, reason="No isolated PostgreSQL test connection configured")
def test_actual_postgresql_predicates_follow_interval_contract():
    bands = [
        "04 TO 06", "07 TO 09", "05 TO 06", "04 TO 09", "02 TO 05",
        "08 TO 10", "01 TO 03", "09 TO 12", "05 TO 05", " 4  TO  6 ",
        None, "", "   ", "floor 04 TO 06", "04-06", "04 to 06", "09 TO 04",
        "00 TO 03", "1000 TO 1001", "04 TO 06\n", "04\tTO 06", "5",
        "999999999999999999999999 TO 06", "01 TO 999", "999 TO 999",
    ]

    async def run():
        connection = await asyncpg.connect(TEST_POSTGRES_DSN)
        try:
            async def matched(**bounds):
                values = [bands]
                parts = main._storey_overlap_predicates(SearchRequest(**bounds), values)
                where = " WHERE " + " AND ".join(parts) if parts else ""
                rows = await connection.fetch(
                    "SELECT h.position FROM unnest($1::text[]) WITH ORDINALITY "
                    "AS h(storey_range, position)" + where + " ORDER BY h.position",
                    *values,
                )
                return [bands[row["position"] - 1] for row in rows]

            assert await matched(min_storey=5, max_storey=8) == bands[:6] + bands[8:10] + ["01 TO 999"]
            assert await matched(min_storey=5, max_storey=5) == [
                "04 TO 06", "04 TO 09", "02 TO 05", "05 TO 05", " 4  TO  6 ", "01 TO 999"
            ]
            assert await matched(min_storey=5) == bands[:6] + bands[7:10] + ["01 TO 999", "999 TO 999"]
            assert await matched(max_storey=5) == [
                "04 TO 06", "05 TO 06", "04 TO 09", "02 TO 05", "01 TO 03", "05 TO 05", " 4  TO  6 ", "01 TO 999"
            ]
            assert await matched() == bands
        finally:
            await connection.close()

    asyncio.run(run())
