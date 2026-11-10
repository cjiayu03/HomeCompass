import asyncio
from datetime import datetime, timezone

import httpx

from app import main
from app.scoring import POLICY_VERSION


class _Connection:
    def __init__(self, rows):
        self.rows = rows

    async def fetchrow(self, sql, *_values):
        if "SELECT count(*) AS total" in sql:
            return {"total": len(self.rows), "geocoded": sum(row["latitude"] is not None for row in self.rows)}
        if "FROM neighbourhood_resource" in sql:
            return {"schools": 1, "childcare": 1, "care": 1}
        raise AssertionError(f"Unexpected query: {sql}")

    async def fetch(self, sql, *_values):
        if "FROM page_homes h JOIN source_snapshot" in sql:
            return self.rows
        raise AssertionError(f"Unexpected query: {sql}")


class _Pool:
    def __init__(self, connection):
        self.connection = connection

    def acquire(self):
        return self

    async def __aenter__(self):
        return self.connection

    async def __aexit__(self, *_args):
        return None


def _home_row(**overrides):
    row = {
        "id": "home-1",
        "address": "Example Street",
        "town": "BISHAN",
        "flat_type": "4 ROOM",
        "price_observation_cents": 45_000_000,
        "observed_on": datetime(2026, 9, 1).date(),
        "source_semantics": "historical_transaction",
        "floor_area_sqm": 90,
        "geocode_status": "resolved",
        "geometry_source": "onemap",
        "geocoded_at": datetime(2026, 10, 1, tzinfo=timezone.utc),
        "latitude": 1.3,
        "longitude": 103.8,
        "school_name": "Example School",
        "school_distance_m": 200,
        "childcare_name": "Example Childcare",
        "childcare_distance_m": 1_000,
        "care_name": "Example Clinic",
        "care_distance_m": 1_500,
        "in_dengue_cluster": False,
        "source_id": "hdb-resale",
        "source_version": "2026-09",
        "retrieved_at": datetime(2026, 10, 18, 12, tzinfo=timezone.utc),
    }
    row.update(overrides)
    return row


def _post_search(monkeypatch, rows, payload):
    monkeypatch.setattr(main, "require_pool", lambda: _Pool(_Connection(rows)))

    async def request_search():
        async with httpx.AsyncClient(
            transport=httpx.ASGITransport(app=main.app), base_url="http://test"
        ) as client:
            return await client.post("/api/v1/search", json=payload)

    return asyncio.run(request_search())


def _components(item):
    return {component["name"]: component for component in item["scoreDetails"]["components"]}


def test_live_search_scores_raw_price_and_distances_with_request_weights(monkeypatch):
    response = _post_search(
        monkeypatch,
        [_home_row()],
        {
            "budget": 500_000,
            "max_school_distance_m": 1_000,
            "priority_weights": {"school": 3, "childcare": 0, "care": 0, "affordability": 1},
        },
    )

    assert response.status_code == 200
    payload = response.json()
    item = payload["items"][0]
    components = _components(item)
    assert item["score"] == 73.8
    assert item["scoreDetails"]["coverage"] == 1
    assert item["scoreDetails"]["policyVersion"] == POLICY_VERSION
    assert components["school"]["rawValue"] == 200
    assert components["school"]["targetValue"] == 1_000
    assert components["school"]["normalizedValue"] == 80
    assert components["childcare"]["rawValue"] == 1_000
    assert components["childcare"]["normalizedValue"] == 50
    assert components["care"]["rawValue"] == 1_500
    assert components["care"]["normalizedValue"] == 25
    assert components["affordability"]["rawValue"] == 45_000_000
    assert components["affordability"]["targetValue"] == 50_000_000
    assert components["affordability"]["normalizedValue"] == 55
    assert payload["scorePolicyVersion"] == POLICY_VERSION
    assert payload["unappliedCriteria"] == []
    assert any(
        "historical transaction observations" in limitation
        for limitation in payload["limitations"]
    )


def test_missing_geometry_stays_missing_and_low_coverage_score_is_null(monkeypatch):
    row = _home_row(
        latitude=None,
        longitude=None,
        school_name=None,
        school_distance_m=None,
        childcare_name=None,
        childcare_distance_m=None,
        care_name=None,
        care_distance_m=None,
        geometry_source=None,
        geocoded_at=None,
        geocode_status="pending",
    )
    response = _post_search(monkeypatch, [row], {"budget": 500_000})

    item = response.json()["items"][0]
    components = _components(item)
    assert item["score"] is None
    assert item["scoreDetails"]["coverage"] == 0.14
    assert item["scoreDetails"]["missingEvidence"] == ["school", "childcare", "care"]
    assert components["school"]["rawValue"] is None
    assert components["school"]["normalizedValue"] is None
    assert components["childcare"]["normalizedValue"] is None
    assert components["care"]["normalizedValue"] is None
    assert item["lat"] is None
    assert item["lng"] is None
    assert item["geocodeSource"] is None
    assert item["geocodedAt"] is None
    assert item["dengue"]["state"] == "source_unavailable"
    assert item["risk"] == "NEA dengue cluster data unavailable"
    assert item["sourceSemantics"] == "historical_transaction"
    assert item["risks"] == ["Historical resale transaction; not a current listing"]


def test_search_without_budget_preserves_raw_affordability_price(monkeypatch):
    response = _post_search(monkeypatch, [_home_row()], {})

    item = response.json()["items"][0]
    components = _components(item)
    assert item["score"] == 53.9
    assert item["scoreDetails"]["coverage"] == 0.86
    assert item["scoreDetails"]["missingEvidence"] == ["affordability"]
    assert components["affordability"]["rawValue"] == 45_000_000
    assert components["affordability"]["targetValue"] is None
    assert components["affordability"]["normalizedValue"] is None
    assert components["affordability"]["evidenceStatus"] == "missing"


def test_search_exposes_the_exact_locations_linked_to_score_distances(monkeypatch):
    import json

    locations = {
        f"{name}_location": json.dumps({
            "id": f"{name}-source-row", "name": f"Verified {name}",
            "resourceType": resource_type, "lat": 1.301 + index / 1000,
            "lng": 103.801, "sourceId": f"{name}-source", "sourceVersion": "2026-09",
            "sourceUrl": "https://data.gov.sg/datasets/example",
        })
        for index, (name, resource_type) in enumerate([
            ("school", "moe_school"), ("childcare", "childcare"), ("care", "chas_clinic")
        ])
    }
    response = _post_search(monkeypatch, [_home_row(**locations)], {"budget": 500000})
    assert response.status_code == 200
    item = response.json()["items"][0]
    assert len(item["scoreLocations"]) == 3
    components = _components(item)
    for location in item["scoreLocations"]:
        component = components[location["component"]]
        assert location["distanceM"] == component["rawValue"]
        assert location["contribution"] == component["contribution"]
        assert location["usedInScore"] is True
        assert location["id"] == f"{location['component']}-source-row"
        assert location["sourceVersion"] == "2026-09"


def test_unranked_and_missing_locations_are_not_claimed_as_scoring_evidence(monkeypatch):
    location = {"id": "school-1", "name": "School", "lat": 1.3, "lng": 103.8}
    response = _post_search(monkeypatch, [_home_row(school_location=location)], {
        "budget": 500000,
        "priority_weights": {"school": 0, "childcare": 0, "care": 0, "affordability": 1},
    })
    item = response.json()["items"][0]
    assert len(item["scoreLocations"]) == 1
    assert item["scoreLocations"][0]["usedInScore"] is False
    assert main._home(_home_row(latitude=None, school_distance_m=None,
        childcare_distance_m=None, care_distance_m=None))["scoreLocations"] == []


def test_amenity_labels_do_not_render_source_replacement_characters():
    name = 'THK\ufffdActive Ageing Centre\ufffd@ Kaki Bukit'
    item = main._home(_home_row(care_name=name, care_location={
        'id': 'care-1', 'name': name, 'lat': 1.3, 'lng': 103.8,
    }))
    assert item['care'] == 'THK Active Ageing Centre @ Kaki Bukit · 1,500 m straight-line'
    assert item['scoreLocations'][0]['name'] == 'THK Active Ageing Centre @ Kaki Bukit'
