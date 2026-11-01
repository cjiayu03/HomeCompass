import { test, expect } from '@playwright/test';

test.use({ reducedMotion: 'reduce', launchOptions: { args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] } });
for (const width of [1440, 390]) {
  test(`selection shows the linked score amenities independently of map layers at ${width}px`, async ({ page }) => {
    test.setTimeout(60000);
    await page.setViewportSize({ width, height: 1000 });
    const errors = [];
    page.on('pageerror', error => errors.push(error.stack || error.message));
    const locations = [
      { id: 'school', component: 'school', name: 'Scoring school', resourceType: 'moe_school', lat: 1.332, lng: 103.851, distanceM: 280, usedInScore: true },
      { id: 'childcare', component: 'childcare', name: 'Scoring childcare', resourceType: 'childcare', lat: 1.334, lng: 103.849, distanceM: 0, usedInScore: true },
      { id: 'care', component: 'care', name: 'Nearby clinic', resourceType: 'chas_clinic', lat: 1.334, lng: 103.849, distanceM: 0, usedInScore: false },
    ];
    const first = { id: 'evidence-home', address: '123 Toa Payoh Central', town: 'Toa Payoh', type: '4-room', price: 540000, lat: 1.334, lng: 103.849, sourceSemantics: 'historical_transaction', observedOn: '2026-09-01', score: 76, scoreLocations: locations, risks: [], highlights: [] };
    const second = { ...first, id: 'other-home', address: '124 Toa Payoh Central', lat: 1.34, lng: 103.86, scoreLocations: [] };
    await page.route('**/api/v1/**', route => {
      const path = new URL(route.request().url()).pathname;
      const payload = path === '/api/v1/map/walking-route' ? { coordinates: [[103.849, 1.334], [103.85, 1.335], [103.851, 1.332]], distanceM: 320 } : path === '/api/v1/auth/session' ? { user: null } : path === '/api/v1/homes' || path === '/api/v1/search' ? { items: [first, second], count: 2, total: 2, hasMore: false, dataMode: 'live' } : path === '/api/v1/search/options' ? { towns: ['Toa Payoh'], flatTypes: ['4 ROOM'] } : { items: [], features: [], counts: [] };
      return route.fulfill({ json: payload });
    });
    await page.route('https://*.tile.openstreetmap.org/**', route => route.abort());
    await page.route('https://tiles.openfreemap.org/styles/**', route => route.fulfill({ json: { version: 8, sources: {}, layers: [{ id: 'background', type: 'background', paint: { 'background-color': '#e7eee9' } }] } }));
    await page.route('https://tiles.openfreemap.org/planet', route => route.fulfill({ json: { tilejson: '3.0.0', tiles: ['https://map.example.test/{z}/{x}/{y}.pbf'], minzoom: 0, maxzoom: 14, vector_layers: [{ id: 'building', fields: {} }] } }));
    await page.route('https://map.example.test/**', route => route.fulfill({ contentType: 'application/x-protobuf', body: '' }));
    await page.goto('/explore');
    await expect(page.locator('article[data-home-id="evidence-home"]')).toBeVisible();
    await page.locator('article[data-home-id="evidence-home"]').getByRole('button', { name: 'Details', exact: true }).click();
    await expect(page.locator('.score-evidence-marker')).toHaveCount(3);
    for (const icon of ['map-pinned', 'baby', 'stethoscope']) await expect(page.locator(`.score-evidence-marker .lucide-${icon}`)).toHaveCount(1);
    await expect(page.locator('.score-evidence-connection')).toHaveCount(3);
    await expect(page.locator('.score-location-label')).toHaveCount(0);
    const childcare = await page.locator('.score-evidence-marker[title="Childcare: Scoring childcare"]').boundingBox();
    const care = await page.locator('.score-evidence-marker[title="Care access: Nearby clinic"]').boundingBox();
    expect(Math.hypot(childcare.x - care.x, childcare.y - care.y)).toBeGreaterThanOrEqual(35);
    await page.locator('.score-evidence-marker[title="School: Scoring school"]').dispatchEvent('click');
    await expect(page.locator('.leaflet-popup-content')).toContainText('Scoring school');
    await page.getByRole('button', { name: 'Next record', exact: true }).click();
    await expect(page.locator('.score-evidence-marker')).toHaveCount(0);
    await expect(page.locator('.score-location-label')).toHaveCount(0);
    await page.getByRole('button', { name: 'Previous record', exact: true }).click();
    await expect(page.locator('.score-evidence-marker')).toHaveCount(3);
    if (width < 768) await page.getByRole('button', { name: 'Show on map', exact: true }).click();
    await page.getByRole('button', { name: 'Close record details' }).click();
    await page.locator('.score-map-legend > summary').click();
    await expect(page.locator('.score-map-legend')).toContainText('Nearby evidence · not included in score');
    await expect(page.locator('.score-map-legend')).toContainText('Paths show OneMap walking routes.', { ignoreCase: true });

    if (width >= 768) {
      await page.getByLabel('Map options', { exact: true }).click();
      await page.getByRole('button', { name: '3D', exact: true }).click();
      await page.getByLabel('Map options', { exact: true }).click();
      await expect(page.locator('.maplibregl-canvas')).toBeVisible({ timeout: 20000 });
      await expect(page.getByText('Building your 3D neighbourhood…', { exact: true })).toHaveCount(0, { timeout: 20000 });
      await expect(page.locator('.score-map-legend')).toContainText('3 supporting locations');
    }
    expect(errors).toEqual([]);
  });
}
