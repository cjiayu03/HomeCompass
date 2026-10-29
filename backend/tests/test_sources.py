import asyncio
import io
import json
import zipfile

import httpx
import pytest

from app.sources import data_gov_sg
from app.sources import data_gov_resources, onemap_geocode
from app.sources.data_gov_sg import download_hdb_csv, parse_hdb_rows


CSV = """month,town,flat_type,block,street_name,storey_range,floor_area_sqm,flat_model,lease_commence_date,remaining_lease,resale_price
2026-08,ANG MO KIO,4 ROOM,123,ANG MO KIO AVE 3,04 TO 06,92.0,Model A,1988,61 years,500000
not-a-month,BEDOK,3 ROOM,22,BEDOK NORTH ST 1,01 TO 03,67.0,Model B,1980,53 years,300000
"""


def test_hdb_rows_are_normalized_and_bad_records_are_counted():
    rows, rejected, newest = parse_hdb_rows(CSV.encode())
    assert len(rows) == 1
    assert rejected == 1
    assert newest.isoformat() == "2026-08-01"
    assert rows[0][1:6] == ("123 ANG MO KIO AVE 3", "Ang Mo Kio", "4 ROOM", 50_000_000, newest)
    assert rows[0][0].startswith("hdb-")
    assert parse_hdb_rows(CSV.encode())[0][0][0] == rows[0][0]


def test_identical_source_rows_are_preserved_with_distinct_ids():
    lines = CSV.splitlines()
    payload = "\n".join((lines[0], lines[1], lines[1])) + "\n"
    rows, rejected, _ = parse_hdb_rows(payload.encode())
    assert rejected == 0
    assert len(rows) == 2
    assert rows[0][0] != rows[1][0]


def test_csv_zip_must_have_one_csv():
    archive = io.BytesIO()
    with zipfile.ZipFile(archive, "w") as zipped:
        zipped.writestr("resale.csv", CSV)
    rows, rejected, _ = parse_hdb_rows(archive.getvalue())
    assert len(rows) == 1
    assert rejected == 1


def test_parser_rejects_missing_required_source_fields():
    with pytest.raises(ValueError, match="expected public resale-price schema"):
        parse_hdb_rows(b"month,town\n2026-08,ANG MO KIO\n")


def test_parser_does_not_allow_all_invalid_rows_to_replace_a_snapshot():
    lines = CSV.splitlines()
    payload = "\n".join((lines[0], "not-a-month,BEDOK,3 ROOM,22,BEDOK NORTH ST 1,01 TO 03,67.0,Model B,1980,53 years,-1")) + "\n"
    with pytest.raises(ValueError, match="No valid HDB resale records"):
        parse_hdb_rows(payload.encode())


def test_parser_rejects_archives_with_multiple_csv_files():
    archive = io.BytesIO()
    with zipfile.ZipFile(archive, "w") as zipped:
        zipped.writestr("first.csv", CSV)
        zipped.writestr("second.csv", CSV)
    with pytest.raises(ValueError, match="exactly one CSV"):
        parse_hdb_rows(archive.getvalue())


def test_parser_preserves_missing_optional_area_and_lease_as_null():
    payload = CSV.replace("92.0,Model A,1988,", ",Model A,unknown,").encode()
    rows, rejected, _ = parse_hdb_rows(payload)
    assert rejected == 1
    assert rows[0][6] is None
    assert rows[0][8] is None


def test_parser_rejects_bad_area_without_rejecting_neighboring_valid_row():
    lines = CSV.splitlines()
    bad_area = lines[1].replace(",92.0,", ",-1,")
    payload = "\n".join((lines[0], lines[1], bad_area)) + "\n"
    rows, rejected, _ = parse_hdb_rows(payload.encode())
    assert len(rows) == 1
    assert rejected == 1


def test_parser_stops_before_processing_rows_over_configured_limit(monkeypatch):
    monkeypatch.setattr(data_gov_sg, "MAX_RECORDS", 1)
    lines = CSV.splitlines()
    payload = "\n".join((lines[0], lines[1], lines[1])) + "\n"
    with pytest.raises(ValueError, match="record count exceeded"):
        parse_hdb_rows(payload.encode())


def test_data_gov_sg_download_flow_is_bounded_and_allows_only_trusted_urls(monkeypatch):
    monkeypatch.setenv("DATA_GOV_SG_DOWNLOAD_HOSTS", "data.gov.sg,storage.data.gov.sg")
    calls = {"poll": 0}

    async def handler(request):
        if request.url.path.endswith("initiate-download"):
            return httpx.Response(201, json={"code": 0, "data": {"message": "started"}})
        if request.url.path.endswith("poll-download"):
            calls["poll"] += 1
            if calls["poll"] == 1:
                return httpx.Response(201, json={"code": 0, "data": {"status": "PROCESSING"}})
            return httpx.Response(201, json={"code": 0, "data": {"status": "AVAILABLE", "url": "https://storage.data.gov.sg/hdb.csv"}})
        if request.url.host == "storage.data.gov.sg":
            return httpx.Response(200, content=CSV.encode())
        raise AssertionError(request.url)

    async def run():
        async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
            return await download_hdb_csv(client, poll_interval_seconds=0, max_polls=3)

    assert asyncio.run(run()) == CSV.encode()
    assert calls["poll"] == 2


def test_data_gov_sg_rejects_an_untrusted_download_host(monkeypatch):
    monkeypatch.setenv("DATA_GOV_SG_DOWNLOAD_HOSTS", "data.gov.sg")

    async def handler(request):
        return httpx.Response(201, json={"code": 0, "data": {"status": "AVAILABLE", "url": "https://127.0.0.1/private.csv"}})

    async def run():
        async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
            await download_hdb_csv(client, poll_interval_seconds=0, max_polls=1)

    with pytest.raises(ValueError, match=r"host='127\.0\.0\.1'"):
        asyncio.run(run())


def test_data_gov_sg_wildcard_allows_any_https_download_host(monkeypatch):
    monkeypatch.setenv("DATA_GOV_SG_DOWNLOAD_HOSTS", "*")
    calls = []

    async def handler(request):
        calls.append(request.url.host)
        if request.url.path.endswith("initiate-download"):
            assert request.headers.get("x-api-key") == "test-api-key"
            return httpx.Response(201, json={"code": 0, "data": {"message": "started"}})
        if request.url.path.endswith("poll-download"):
            assert request.headers.get("x-api-key") == "test-api-key"
            return httpx.Response(201, json={"code": 0, "data": {"status": "AVAILABLE", "url": "https://s3.ap-southeast-1.amazonaws.com/export/hdb.csv?signature=redacted"}})
        if request.url.host == "s3.ap-southeast-1.amazonaws.com":
            assert "x-api-key" not in request.headers
            return httpx.Response(200, content=CSV.encode())
        raise AssertionError(request.url.host)

    async def run():
        async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
            return await download_hdb_csv(client, api_key="test-api-key", poll_interval_seconds=0, max_polls=1)

    assert asyncio.run(run()) == CSV.encode()
    assert calls[-1] == "s3.ap-southeast-1.amazonaws.com"


def test_data_gov_sg_wildcard_does_not_follow_download_redirects(monkeypatch):
    monkeypatch.setenv("DATA_GOV_SG_DOWNLOAD_HOSTS", "*")
    download_attempts = []

    async def handler(request):
        if request.url.path.endswith("initiate-download"):
            return httpx.Response(201, json={"code": 0, "data": {"message": "started"}})
        if request.url.path.endswith("poll-download"):
            return httpx.Response(201, json={"code": 0, "data": {"status": "AVAILABLE", "url": "https://s3.ap-southeast-1.amazonaws.com/export/hdb.csv"}})
        download_attempts.append(request.url.host)
        return httpx.Response(302, headers={"location": "https://metadata.google.internal/latest/meta-data/"})

    async def run():
        async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
            await download_hdb_csv(client, poll_interval_seconds=0, max_polls=1)

    with pytest.raises(ValueError, match="redirected"):
        asyncio.run(run())
    assert download_attempts == ["s3.ap-southeast-1.amazonaws.com"]


def test_data_gov_sg_wildcard_still_requires_an_absolute_https_url(monkeypatch):
    monkeypatch.setenv("DATA_GOV_SG_DOWNLOAD_HOSTS", "*")
    with pytest.raises(ValueError, match="HTTPS host policy"):
        data_gov_sg._safe_download_url("http://downloads.example/hdb.csv")
    with pytest.raises(ValueError, match="HTTPS host policy"):
        data_gov_sg._safe_download_url("https:///hdb.csv")


def test_data_gov_sg_rejects_terminal_download_failure():
    async def handler(request):
        if request.url.path.endswith("initiate-download"):
            return httpx.Response(201, json={"code": 0, "data": {"message": "started"}})
        return httpx.Response(201, json={"code": 0, "data": {"status": "FAILED"}})

    async def run():
        async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
            await download_hdb_csv(client, poll_interval_seconds=0, max_polls=2)

    with pytest.raises(RuntimeError, match="download failed"):
        asyncio.run(run())


def test_data_gov_sg_times_out_when_export_stays_processing():
    async def handler(request):
        if request.url.path.endswith("initiate-download"):
            return httpx.Response(201, json={"code": 0, "data": {"message": "started"}})
        return httpx.Response(201, json={"code": 0, "data": {"status": "PROCESSING"}})

    async def run():
        async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
            await download_hdb_csv(client, poll_interval_seconds=0, max_polls=1)

    with pytest.raises(TimeoutError, match="polling deadline"):
        asyncio.run(run())


def test_data_gov_sg_rejects_invalid_dataset_id_before_network_request():
    async def handler(_request):
        raise AssertionError("No request should be sent for an invalid dataset identifier.")

    async def run():
        async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
            await download_hdb_csv(client, dataset_id="https://example.com")

    with pytest.raises(ValueError, match="Invalid data.gov.sg dataset ID"):
        asyncio.run(run())


def test_all_registered_public_layers_have_independent_dataset_sources():
    assert len(data_gov_resources.SOURCES) == 17
    assert len({source.dataset_id for source in data_gov_resources.SOURCES}) == 17
    assert {"moe_school", "student_care", "childcare_fees", "dengue_cluster", "community_club", "eldercare", "park_facility"}.issubset(
        {source.resource_type for source in data_gov_resources.SOURCES}
    )


def test_student_care_geojson_schema_is_imported_without_direct_contact_fields():
    source = next(source for source in data_gov_resources.SOURCES if source.resource_type == "student_care")
    payload = json.dumps({"type": "FeatureCollection", "features": [{
        "type": "Feature",
        "geometry": {"type": "Point", "coordinates": [103.8, 1.3]},
        "properties": {"OBJECTID": 42, "NAME_OF_STUDENT_CARE_CENTRE": "Example Student Care", "SCC_POSTAL_CODE": "123456", "SCC_TELEPHONE": "60000000", "SCC_EMAIL": "care@example.invalid", "MONTHLY_FEE": "$300"},
    }]}).encode()

    rows, rejected = data_gov_resources.parse_resource_payload(source, payload)

    assert rejected == 0
    assert len(rows) == 1
    assert json.loads(rows[0][1]) == {"type": "Point", "coordinates": [103.8, 1.3]}
    assert rows[0][2]["_source_name"] == "Example Student Care"
    assert rows[0][2]["MONTHLY_FEE"] == "$300"
    assert "SCC_TELEPHONE" not in rows[0][2]
    assert "SCC_EMAIL" not in rows[0][2]


def test_moe_school_csv_is_retained_without_fabricating_geometry():
    source = next(source for source in data_gov_resources.SOURCES if source.resource_type == "moe_school")
    rows, rejected = data_gov_resources.parse_resource_payload(
        source,
        b"school_name,postal_code,address,principal_name\nExample Primary,123456,123 Example Road,Not Imported\n",
    )

    assert rejected == 0
    assert rows[0][1] is None
    assert rows[0][2]["_source_name"] == "Example Primary"
    assert "principal_name" not in rows[0][2]


def test_onemap_geocoder_requires_an_exact_home_street_match_and_bounds():
    result = [{"BLK_NO": "123", "ROAD_NAME": "ANG MO KIO AVE 3", "POSTAL": "560123", "LONGITUDE": "103.85", "LATITUDE": "1.37"}]
    assert onemap_geocode._match_home("123 ANG MO KIO AVENUE 3", result) == (103.85, 1.37)
    assert onemap_geocode._match_home("124 ANG MO KIO AVENUE 3", result) is None
    outside = [{"BLK_NO": "123", "ROAD_NAME": "ANG MO KIO AVE 3", "POSTAL": "560123", "LONGITUDE": "1.37", "LATITUDE": "103.85"}]
    assert onemap_geocode._match_home("123 ANG MO KIO AVE 3", outside) is None


@pytest.mark.parametrize(
    ("hdb_address", "onemap_road"),
    [
        ("122 BEDOK NTH ST 2", "BEDOK NORTH STREET 2"),
        ("101 BT BATOK WEST AVE 6", "BUKIT BATOK WEST AVENUE 6"),
        ("106 BT BATOK CTRL", "BUKIT BATOK CENTRAL"),
        ("220 LOR 8 TOA PAYOH", "LORONG 8 TOA PAYOH"),
        ("2 EVERTON PK", "EVERTON PARK"),
        ("52 C'WEALTH DR", "COMMONWEALTH DRIVE"),
        ("62 JLN MA'MOR", "JALAN MAMOR"),
        ("1 ST. GEORGE'S RD", "SAINT GEORGE'S ROAD"),
        ("32 NEW MKT RD", "NEW MARKET ROAD"),
    ],
)
def test_onemap_home_geocoder_accepts_verified_hdb_road_abbreviations(hdb_address, onemap_road):
    block = hdb_address.split(maxsplit=1)[0]
    result = [{"BLK_NO": block, "ROAD_NAME": onemap_road, "POSTAL": "123456", "LONGITUDE": 103.85, "LATITUDE": 1.3}]
    assert onemap_geocode._match_home(hdb_address, result) == (103.85, 1.3)


def test_onemap_home_geocoder_ignores_nil_postal_pois_but_rejects_two_buildings():
    building = {"BLK_NO": "348", "ROAD_NAME": "ANG MO KIO AVENUE 3", "POSTAL": "560348", "LONGITUDE": 103.8479, "LATITUDE": 1.3662}
    poi = {"BLK_NO": "348", "ROAD_NAME": "ANG MO KIO AVENUE 3", "POSTAL": "NIL", "LONGITUDE": 103.8477, "LATITUDE": 1.3662}
    assert onemap_geocode._match_home("348 ANG MO KIO AVE 3", [building, poi]) == (103.8479, 1.3662)
    another_building = {**building, "POSTAL": "560349", "LONGITUDE": 103.848}
    assert onemap_geocode._match_home("348 ANG MO KIO AVE 3", [building, another_building]) is None
    assert onemap_geocode._match_home("348 ANG MO KIO AVE 3", [building, another_building], {"560348"}) == (103.8479, 1.3662)
    assert onemap_geocode._match_home("348 ANG MO KIO AVE 3", [poi]) is None


def test_onemap_home_geocoder_excludes_a_car_park_sharing_a_residential_postal():
    home = {"BLK_NO": "1", "ROAD_NAME": "TANJONG PAGAR PLAZA", "BUILDING": "TANJONG PAGAR PLAZA", "POSTAL": "082001", "LONGITUDE": 103.84239, "LATITUDE": 1.27515}
    car_park = {**home, "BUILDING": "MULTI STOREY CAR PARK", "LONGITUDE": 103.84243, "LATITUDE": 1.27568}
    assert onemap_geocode._match_home("1 TG PAGAR PLAZA", [car_park, home]) == (103.84239, 1.27515)


def test_onemap_school_geocoder_requires_one_exact_postcode_coordinate():
    assert onemap_geocode._match_postal("123456", [{"POSTAL": "123456", "LONGITUDE": 103.8, "LATITUDE": 1.3}]) == (103.8, 1.3)
    ambiguous = [
        {"POSTAL": "123456", "LONGITUDE": 103.8, "LATITUDE": 1.3},
        {"POSTAL": "123456", "LONGITUDE": 103.81, "LATITUDE": 1.31},
    ]
    assert onemap_geocode._match_postal("123456", ambiguous) is None


def test_onemap_school_geocoder_selects_the_named_school_at_a_shared_postcode():
    church = {"BUILDING": "ALL SAINTS' CHURCH, SINGAPORE", "POSTAL": "487012", "LONGITUDE": 103.94108, "LATITUDE": 1.33058}
    school = {"BUILDING": "ANGLICAN HIGH SCHOOL", "POSTAL": "487012", "LONGITUDE": 103.94185, "LATITUDE": 1.33118}
    assert onemap_geocode._match_postal("487012", [church, school], "ANGLICAN HIGH SCHOOL") == (103.94185, 1.33118)
    assert onemap_geocode._match_postal("487012", [church, school], "ANOTHER SCHOOL") is None


def test_onemap_school_geocoder_restores_leading_zero_and_saint_name():
    assert onemap_geocode._school_postal({"postal_code": "88256"}) == "088256"
    assert onemap_geocode._school_postal({"POSTAL_CODE": "487012"}) == "487012"
    assert onemap_geocode._school_postal({"postal_code": "unknown"}) is None
    convent = {"BUILDING": "CHIJ SAINT THERESA'S CONVENT", "POSTAL": "099138", "LONGITUDE": 103.82244, "LATITUDE": 1.27535}
    other = {"BUILDING": "OTHER BUILDING", "POSTAL": "099138", "LONGITUDE": 103.823, "LATITUDE": 1.2755}
    assert onemap_geocode._match_postal("099138", [convent, other], "CHIJ ST. THERESA'S CONVENT") == (103.82244, 1.27535)


def test_onemap_queue_queries_bind_retry_flag_without_unexpanded_placeholders():
    assert "{" not in onemap_geocode._HOME_QUEUE_QUERY
    assert "{" not in onemap_geocode._SCHOOL_QUEUE_QUERY
    assert "$2::boolean" in onemap_geocode._HOME_QUEUE_QUERY
    assert "$3::boolean" in onemap_geocode._SCHOOL_QUEUE_QUERY
    assert "geocode_status='pending'" in onemap_geocode._HOME_QUEUE_QUERY
    assert "geocode_status='failed'" in onemap_geocode._HOME_QUEUE_QUERY
    assert "geocodeStatus','pending')='pending'" in onemap_geocode._SCHOOL_QUEUE_QUERY
    assert "geocodeStatus','pending')='failed'" in onemap_geocode._SCHOOL_QUEUE_QUERY


def test_onemap_school_update_uses_uuid_consistently_for_snapshot_id():
    query = onemap_geocode._SCHOOL_GEOCODE_UPDATE_QUERY
    assert "location_source_snapshot_id=$4::uuid" in query
    assert "'geocodeSourceSnapshotId',$4::uuid::text" in query


def test_onemap_search_retries_a_remote_disconnect(monkeypatch):
    async def no_wait(_seconds):
        return None

    class DisconnectOnce:
        calls = 0

        async def get(self, *_args, **_kwargs):
            self.calls += 1
            if self.calls == 1:
                raise httpx.RemoteProtocolError("server disconnected")
            return httpx.Response(
                200,
                request=httpx.Request("GET", onemap_geocode.SEARCH_URL),
                json={"found": 1, "results": [{"POSTAL": "123456"}]},
            )

    monkeypatch.setattr(onemap_geocode.asyncio, "sleep", no_wait)
    client = DisconnectOnce()
    results = asyncio.run(onemap_geocode._search(client, "test-token", "123456"))

    assert client.calls == 2
    assert results == [{"POSTAL": "123456"}]


def test_onemap_search_includes_second_page_for_large_shared_campuses(monkeypatch):
    async def no_wait(_seconds):
        return None

    class TwoPages:
        pages = []

        async def get(self, *_args, **kwargs):
            page = kwargs["params"]["pageNum"]
            self.pages.append(page)
            data = {
                "found": 12,
                "totalNumPages": 2,
                "results": [{"BUILDING": "RAFFLES INSTITUTION" if page == 2 else "RAFFLES INSTITUTION (AUDITORIUM)", "POSTAL": "575954"}],
            }
            return httpx.Response(200, request=httpx.Request("GET", onemap_geocode.SEARCH_URL), json=data)

    monkeypatch.setattr(onemap_geocode.asyncio, "sleep", no_wait)
    client = TwoPages()
    results = asyncio.run(onemap_geocode._search(client, "test-token", "575954"))

    assert client.pages == [1, 2]
    assert [item["BUILDING"] for item in results] == ["RAFFLES INSTITUTION (AUDITORIUM)", "RAFFLES INSTITUTION"]


@pytest.mark.parametrize(("resource_type", "published_name"), [
    ("community_club", "ACE The Place CC"),
    ("eldercare", "Yuhua Senior Activity Centre"),
])
def test_legacy_amenity_table_heading_does_not_shift_name_fields(resource_type, published_name):
    source = next(source for source in data_gov_resources.SOURCES if source.resource_type == resource_type)
    description = ("<table><tr><th colspan='2'>Attributes</th></tr>"
                   "<tr><th>ADDRESSBUILDINGNAME</th><td></td></tr>"
                   f"<tr><th>NAME</th><td>{published_name}</td></tr>"
                   "<tr><th>FMEL_UPD_D</th><td>20211109134550</td></tr></table>")
    payload = json.dumps({"type": "FeatureCollection", "features": [{
        "type": "Feature", "properties": {"Name": "kml_1", "Description": description},
        "geometry": {"type": "Point", "coordinates": [103.8, 1.3, 0]},
    }]}).encode()
    rows, rejected = data_gov_resources.parse_resource_payload(source, payload)
    assert rejected == 0
    assert rows[0][2]["_source_name"] == published_name
    assert data_gov_resources.source_update_time(rows).isoformat() == "2021-11-09T13:45:50+00:00"


def test_unnamed_park_facilities_keep_the_published_class_and_location():
    source = next(source for source in data_gov_resources.SOURCES if source.resource_type == "park_facility")
    geometry = {"type": "Point", "coordinates": [103.8, 1.3]}
    payload = json.dumps({"type": "FeatureCollection", "features": [{
        "type": "Feature", "geometry": geometry,
        "properties": {"OBJECTID": 1, "NAME": None, "CLASS": "FITNESS AREA"},
    }]}).encode()
    rows, rejected = data_gov_resources.parse_resource_payload(source, payload)
    assert rejected == 0
    assert rows[0][2]["_source_name"] == "FITNESS AREA"
    assert json.loads(rows[0][1]) == geometry
