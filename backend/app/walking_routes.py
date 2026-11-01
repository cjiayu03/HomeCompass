"""Bounded OneMap walking routes; coordinates are GeoJSON longitude, latitude."""
import math

import httpx

ROUTE_URL = 'https://www.onemap.gov.sg/api/public/routingsvc/route'


def decode_route(encoded: str) -> list[list[float]]:
    if not isinstance(encoded, str) or len(encoded) > 100_000:
        raise ValueError('Invalid route geometry')
    index = latitude = longitude = 0
    points = []
    while index < len(encoded):
        values = []
        for _ in range(2):
            result = shift = 0
            while True:
                if index >= len(encoded) or shift > 30:
                    raise ValueError('Invalid route geometry')
                value = ord(encoded[index]) - 63
                index += 1
                if value < 0 or value > 63:
                    raise ValueError('Invalid route geometry')
                result |= (value & 31) << shift
                shift += 5
                if value < 32:
                    break
            values.append(~(result >> 1) if result & 1 else result >> 1)
        latitude += values[0]
        longitude += values[1]
        lat, lng = latitude / 100_000, longitude / 100_000
        if not (1 <= lat <= 2 and 103 <= lng <= 105):
            raise ValueError('Route outside Singapore')
        points.append([lng, lat])
    if len(points) < 2:
        raise ValueError('Empty route')
    return points


async def walking_route(client: httpx.AsyncClient, token: str, start: tuple, end: tuple) -> dict:
    response = await client.get(ROUTE_URL, params={'start': f'{start[0]},{start[1]}', 'end': f'{end[0]},{end[1]}', 'routeType': 'walk'}, headers={'Authorization': token}, follow_redirects=False)
    response.raise_for_status()
    data = response.json()
    if not isinstance(data, dict) or data.get('status') != 0:
        raise ValueError('Route unavailable')
    coordinates = decode_route(data.get('route_geometry'))
    distance = data.get('route_summary', {}).get('total_distance')
    if isinstance(distance, bool) or not isinstance(distance, (int, float)) or not math.isfinite(distance) or distance < 0:
        raise ValueError('Invalid distance')
    return {'coordinates': coordinates, 'distanceM': distance}
