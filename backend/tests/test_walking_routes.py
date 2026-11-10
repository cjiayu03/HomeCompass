import asyncio
import httpx
import pytest

from app.walking_routes import decode_route, walking_route


def test_decodes_onemap_geometry():
    points = decode_route('{u`GktxxR?G')
    assert points[0] == pytest.approx([103.84214, 1.3195])
    assert points[1] == pytest.approx([103.84218, 1.3195])


def test_walking_route_uses_authorized_fixed_provider_and_returns_geometry():
    def respond(request):
        assert str(request.url).startswith('https://www.onemap.gov.sg/api/public/routingsvc/route?')
        assert request.url.params['routeType'] == 'walk'
        assert request.headers['Authorization'] == 'test-token'
        return httpx.Response(200, json={'status': 0, 'route_geometry': '{u`GktxxR?G', 'route_summary': {'total_distance': 5}})
    async def run():
        async with httpx.AsyncClient(transport=httpx.MockTransport(respond)) as client:
            return await walking_route(client, 'test-token', (1.319498, 103.842142), (1.319498, 103.842146))
    result = asyncio.run(run())
    assert result['distanceM'] == 5
    assert len(result['coordinates']) == 2


def test_route_endpoint_validates_coordinates_and_hides_provider_errors(monkeypatch):
    from app import main
    from app.rate_limit import RateLimiter
    monkeypatch.setenv('ONEMAP_ACCESS_TOKEN', 'test-token')
    monkeypatch.setattr(main, 'address_search_limiter', RateLimiter(max_requests=20, window_seconds=60))

    async def broken(*args):
        raise ValueError('sensitive upstream error')
    monkeypatch.setattr(main, 'walking_route', broken)
    async def run():
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app=main.app), base_url='http://test') as client:
            invalid = await client.post('/api/v1/map/walking-route', json={'start_lat': 20, 'start_lng': 103.8, 'end_lat': 1.3, 'end_lng': 103.8})
            failed = await client.post('/api/v1/map/walking-route', json={'start_lat': 1.3, 'start_lng': 103.8, 'end_lat': 1.31, 'end_lng': 103.81})
            return invalid, failed
    invalid, failed = asyncio.run(run())
    assert invalid.status_code == 422
    assert failed.status_code == 502
    assert 'sensitive upstream error' not in failed.text
    assert 'test-token' not in failed.text
