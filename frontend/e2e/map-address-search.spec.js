import { expect, test } from '@playwright/test';

test.use({
  reducedMotion: 'reduce',
  launchOptions: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH
    ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] }
    : { args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] },
});

const address = '505 ANG MO KIO AVENUE 8 CHENG SAN CREST SINGAPORE 560505';
const candidate = {
  address,
  latitude: 1.374859730212297,
  longitude: 103.8502249014036,
  provider: 'OneMap',
};

const homes = Array.from({ length: 12 }, (_, index) => ({
  id: `map-address-home-${index}`,
  address: `${123 + index} Toa Payoh Central`,
  town: 'Toa Payoh',
  type: '4-room',
  price: 540000,
  floorAreaSqm: 93,
  storeyRange: '04 TO 06',
  remainingLeaseYears: 65,
  source: 'data.gov.sg · hdb-resale',
  sourceUpdated: '2026-09-01',
  observedOn: '2024-06-03',
  sourceSemantics: 'historical_transaction',
  geocodeStatus: 'resolved',
  lat: index === 1 ? 1.42 : 1.335,
  lng: index === 1 ? 103.96 : 103.849,
  highlights: [],
  risks: ['Historical transaction, not a current listing'],
}));

async function installApiRoutes(page, { addressResults = [candidate], onAddressSearch, useLiveAddressSearch = false, onLiveAddressResponse, allowTiles = false } = {}) {
  await page.route('**/api/v1/**', async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    if (path === '/api/v1/map/address-search') {
      onAddressSearch?.(request);
      if (useLiveAddressSearch) {
        const headers = { 'content-type': request.headers()['content-type'] || 'application/json' };
        if (request.headers().origin) headers.origin = request.headers().origin;
        const liveResponse = await route.fetch({
          url: 'http://127.0.0.1:8000/api/v1/map/address-search',
          method: request.method(),
          headers,
          data: request.postData(),
        });
        const payload = await liveResponse.json();
        onLiveAddressResponse?.(liveResponse.status(), payload, liveResponse.headers());
        return route.fulfill({
          status: liveResponse.status(),
          json: payload,
          headers: { 'cache-control': liveResponse.headers()['cache-control'] || 'no-store' },
        });
      }
      return route.fulfill({ json: { items: addressResults } });
    }

    let payload;
    if (path === '/api/v1/auth/session') {
      payload = { user: null };
    } else if (path === '/api/v1/homes' || path === '/api/v1/search') {
      payload = { items: homes, count: homes.length, total: homes.length, hasMore: false, dataMode: 'live', warnings: [] };
    } else if (path === '/api/v1/search/options') {
      payload = { towns: ['Toa Payoh'], flatTypes: ['4 ROOM'] };
    } else if (path === '/api/v1/resources') {
      payload = { type: 'FeatureCollection', features: [], dataMode: 'live' };
    } else if (path === '/api/v1/sources') {
      payload = { items: [], state: 'available' };
    } else {
      return route.fulfill({ status: 401, json: { detail: 'Sign in required' } });
    }
    return route.fulfill({ json: payload });
  });
  if (!allowTiles) await page.route('https://*.tile.openstreetmap.org/**', route => route.abort());
}

function intersects(a, b) {
  return a.x < b.x + b.width && a.x + a.width > b.x
    && a.y < b.y + b.height && a.y + a.height > b.y;
}

async function expectLeafletMarkerAtMapCenter(page, label) {
  const marker = page.locator(`.leaflet-marker-icon[title="Selected map location: ${label}"]`);
  await expect(marker).toBeVisible();
  await expect.poll(async () => {
    const mapBox = await page.locator('.leaflet-container').boundingBox();
    const markerBox = await marker.boundingBox();
    if (!mapBox || !markerBox) return false;
    const markerPoint = { x: markerBox.x + 16, y: markerBox.y + 38 };
    return Math.abs(markerPoint.x - (mapBox.x + mapBox.width / 2)) < 4
      && Math.abs(markerPoint.y - (mapBox.y + mapBox.height / 2)) < 4;
  }).toBe(true);
}

async function expectAddressInsideVisibleMapArea(page, label) {
  const marker = page.locator(`.leaflet-marker-icon[title="Selected map location: ${label}"]`);
  const addressLabel = page.locator('.leaflet-tooltip.map-address-label');
  await expect(marker).toBeVisible();
  await expect(addressLabel).toContainText(label);
  await expect.poll(async () => {
    const mapBox = await page.locator('.leaflet-container').boundingBox();
    const markerBox = await marker.boundingBox();
    const labelBox = await addressLabel.boundingBox();
    const detailBox = await page.locator('.map-record-details').boundingBox();
    const sidebar = page.locator('.map-research-sidebar[data-state="open"]');
    const sidebarBox = await sidebar.count() ? await sidebar.boundingBox() : null;
    if (!mapBox || !markerBox || !labelBox || !detailBox) return { ready: false };
    const visibleLeft = Math.max(mapBox.x, sidebarBox ? sidebarBox.x + sidebarBox.width : mapBox.x);
    const visibleRight = Math.min(mapBox.x + mapBox.width, detailBox.x);
    const markerPointX = markerBox.x + markerBox.width / 2;
    return {
      ready: true,
      markerInVisibleArea: markerPointX >= visibleLeft && markerPointX <= visibleRight,
      labelFitsVisibleWidth: labelBox.x >= visibleLeft - 1 && labelBox.x + labelBox.width <= visibleRight + 1,
      labelFitsMapHeight: labelBox.y >= mapBox.y && labelBox.y + labelBox.height <= mapBox.y + mapBox.height,
      visibleLeft,
      visibleRight,
      markerPointX,
      labelBox,
    };
  }).toMatchObject({ ready: true, markerInVisibleArea: true, labelFitsVisibleWidth: true, labelFitsMapHeight: true });
}

async function chooseAddress(page) {
  const input = page.getByLabel('Find an address or postal code');
  await input.fill('560505');
  await input.press('Enter');
  await page.getByRole('button', { name: address, exact: true }).click();
}

test('guest address search moves the real 2D camera, can recenter, and does not run housing actions', async ({ page }) => {
  const addressQueries = [];
  const unrelatedWrites = [];
  page.on('request', (request) => {
    const path = new URL(request.url()).pathname;
    if (request.method() !== 'GET' && path.startsWith('/api/v1/') && path !== '/api/v1/map/address-search') {
      unrelatedWrites.push({ method: request.method(), path });
    }
  });
  await installApiRoutes(page, { onAddressSearch: request => addressQueries.push(JSON.parse(request.postData()).query) });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/explore');
  await page.getByRole('button', { name: 'Map', exact: true }).click();
  await expect(page.locator('.leaflet-container')).toBeVisible();
  const unrelatedWritesBefore = [...unrelatedWrites];

  await chooseAddress(page);
  await expect(page.locator('.leaflet-tooltip.map-address-label')).toContainText(address);
  await expectLeafletMarkerAtMapCenter(page, address);
  expect(addressQueries).toEqual(['560505']);
  expect(unrelatedWrites).toEqual(unrelatedWritesBefore);

  const mapBox = await page.locator('.leaflet-container').boundingBox();
  await page.mouse.move(mapBox.x + mapBox.width / 2, mapBox.y + mapBox.height / 2);
  await page.mouse.down();
  await page.mouse.move(mapBox.x + mapBox.width / 2 + 74, mapBox.y + mapBox.height / 2 + 36, { steps: 5 });
  await page.mouse.up();
  await expect.poll(async () => {
    const markerBox = await page.locator(`.leaflet-marker-icon[title="Selected map location: ${address}"]`).boundingBox();
    const currentMapBox = await page.locator('.leaflet-container').boundingBox();
    if (!markerBox || !currentMapBox) return 0;
    const dx = markerBox.x + 16 - (currentMapBox.x + currentMapBox.width / 2);
    const dy = markerBox.y + 38 - (currentMapBox.y + currentMapBox.height / 2);
    return Math.hypot(dx, dy);
  }).toBeGreaterThan(50);

  await page.getByRole('button', { name: `Show ${address} on map again` }).click();
  await expectLeafletMarkerAtMapCenter(page, address);
  expect(unrelatedWrites).toEqual(unrelatedWritesBefore);
});

for (const viewport of [
  { width: 320, height: 740 },
  { width: 390, height: 844 },
  { width: 768, height: 900 },
  { width: 1280, height: 800 },
]) {
  test(`address search and map controls stay separate at ${viewport.width}px`, async ({ page }) => {
    await installApiRoutes(page);
    await page.setViewportSize(viewport);
    await page.goto('/explore');
    if (viewport.width < 768) await page.getByRole('button', { name: 'Map', exact: true }).click();
    const map = page.locator('section[aria-label="Movable OpenStreetMap view"]');
    await expect(map).toBeVisible();
    const form = page.locator('.map-address-form');
    const searchArea = page.locator('.map-search-area-control button');
    const options = page.locator('.map-tools summary');
    const singapore = page.getByRole('button', { name: 'Center map on Singapore' });
    await expect(form).toBeVisible();
    await expect(searchArea).toBeVisible();
    await expect(options).toBeVisible();
    await expect(singapore).toBeVisible();

    const [mapBox, formBox, areaBox, optionsBox, singaporeBox] = await Promise.all([
      map.boundingBox(), form.boundingBox(), searchArea.boundingBox(), options.boundingBox(), singapore.boundingBox(),
    ]);
    expect(formBox.x).toBeGreaterThanOrEqual(mapBox.x);
    expect(formBox.x + formBox.width).toBeLessThanOrEqual(mapBox.x + mapBox.width + 1);
    expect(formBox.y).toBeGreaterThanOrEqual(mapBox.y);
    expect(formBox.y + formBox.height).toBeLessThanOrEqual(mapBox.y + mapBox.height);
    expect(intersects(formBox, areaBox)).toBe(false);
    expect(intersects(formBox, optionsBox)).toBe(false);
    expect(intersects(formBox, singaporeBox)).toBe(false);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  });
}

for (const viewport of [
  { width: 768, height: 900 },
  { width: 1024, height: 900 },
  { width: 1280, height: 900 },
]) {
  test(`address controls remain usable beside the record detail panel at ${viewport.width}px`, async ({ page }) => {
    const liveResponses = [];
    await installApiRoutes(page, {
      useLiveAddressSearch: viewport.width === 768,
      onLiveAddressResponse: (status, payload, headers) => liveResponses.push({ status, payload, cacheControl: headers['cache-control'] }),
    });
    await page.setViewportSize(viewport);
    await page.goto('/explore');
    await page.getByRole('button', { name: 'Full map' }).click();
    await page.getByRole('button', { name: 'Details', exact: true }).first().click();

    const details = page.locator('.map-record-details');
    const toolbar = details.locator('.detail-map-tools-host');
    const form = toolbar.locator('.map-address-form');
    const options = toolbar.locator('.map-tools summary');
    const singapore = toolbar.getByRole('button', { name: 'Center map on Singapore' });
    await expect(details).toBeVisible();
    await expect(toolbar).toBeVisible();
    await expect(form).toBeVisible();
    await expect(options).toBeVisible();
    await expect(singapore).toBeVisible();

    const [sidebar, detailsBox, toolbarBox, formBox, optionsBox, resetBox] = await Promise.all([
      page.locator('.map-research-sidebar').boundingBox(),
      details.boundingBox(),
      toolbar.boundingBox(),
      form.boundingBox(),
      options.boundingBox(),
      singapore.boundingBox(),
    ]);
    if (viewport.width <= 815) expect(detailsBox.x).toBeGreaterThanOrEqual(sidebar.x + sidebar.width);
    expect(toolbarBox.x).toBeGreaterThanOrEqual(detailsBox.x);
    expect(formBox.x).toBeGreaterThanOrEqual(toolbarBox.x);
    expect(formBox.x + formBox.width).toBeLessThanOrEqual(toolbarBox.x + toolbarBox.width);
    expect(intersects(formBox, optionsBox)).toBe(false);
    expect(intersects(formBox, resetBox)).toBe(false);

    await form.getByLabel('Find an address or postal code').fill('560505');
    await form.getByLabel('Find an address or postal code').press('Enter');
    const result = toolbar.getByRole('button', { name: address, exact: true });
    await expect(result).toBeVisible();
    await result.click();
    await expect(toolbar.getByRole('button', { name: `Show ${address} on map again` })).toBeVisible();
    if (viewport.width <= 1024) await expect(page.locator('.map-research-sidebar')).toHaveAttribute('data-state', 'closed');
    await expectAddressInsideVisibleMapArea(page, address);
    if (viewport.width === 768) {
      expect(liveResponses).toHaveLength(1);
      expect(liveResponses[0].status).toBe(200);
      expect(liveResponses[0].cacheControl).toBe('no-store');
      expect(liveResponses[0].payload.items).toContainEqual(candidate);
      await page.screenshot({ path: '/private/tmp/homecompass-feature3-768-detail.png', fullPage: true });
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  });
}

test('the guest map UI uses a real server-backed OneMap address result and saves review screenshots', async ({ page }) => {
  const liveCalls = [];
  const liveResponses = [];
  await installApiRoutes(page, {
    useLiveAddressSearch: true,
    allowTiles: true,
    onAddressSearch: request => liveCalls.push({ url: request.url(), body: request.postDataJSON() }),
    onLiveAddressResponse: (status, payload, headers) => liveResponses.push({ status, payload, cacheControl: headers['cache-control'] }),
  });

  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto('/explore');
  await chooseAddress(page);
  await expect(page.locator('.leaflet-tooltip.map-address-label')).toContainText(address);
  await expectLeafletMarkerAtMapCenter(page, address);
  await page.screenshot({ path: '/private/tmp/homecompass-feature3-desktop.png', fullPage: true });

  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole('button', { name: 'Map', exact: true }).click();
  await chooseAddress(page);
  await expect(page.locator('.leaflet-tooltip.map-address-label')).toContainText(address);
  await expectLeafletMarkerAtMapCenter(page, address);
  await page.screenshot({ path: '/private/tmp/homecompass-feature3-mobile.png', fullPage: true });

  expect(liveCalls).toHaveLength(2);
  expect(liveCalls.every(call => call.body.query === '560505')).toBe(true);
  expect(liveResponses).toHaveLength(2);
  expect(liveResponses.every(({ status, payload }) => status === 200 && Array.isArray(payload.items) && payload.items.some(item => item.address === address))).toBe(true);
  expect(liveResponses.every(({ cacheControl }) => cacheControl === 'no-store')).toBe(true);
});

test('address camera and marker remain coherent across 2D and 3D modes', async ({ page }) => {
  await installApiRoutes(page);
  await page.route('https://tiles.openfreemap.org/styles/bright', route => route.fulfill({
    json: { version: 8, sources: {}, layers: [{ id: 'background', type: 'background', paint: { 'background-color': '#dbe4eb' } }] },
  }));
  await page.route('https://tiles.openfreemap.org/planet', route => route.fulfill({
    json: {
      tilejson: '3.0.0',
      tiles: ['https://tiles.openfreemap.org/planet/{z}/{x}/{y}.pbf'],
      minzoom: 0,
      maxzoom: 14,
      vector_layers: [{ id: 'building', fields: {}, minzoom: 0, maxzoom: 14 }],
    },
  }));
  await page.route('https://tiles.openfreemap.org/planet/**/*.pbf', route => route.fulfill({
    status: 200,
    headers: { 'content-type': 'application/x-protobuf' },
    body: '',
  }));
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto('/explore');
  await chooseAddress(page);
  await expectLeafletMarkerAtMapCenter(page, address);

  await page.locator('.map-tools summary').click();
  await page.getByRole('button', { name: '3D', exact: true }).click();
  await expect(page.locator('section[aria-label="Movable 3D neighborhood map"]')).toBeVisible({ timeout: 20000 });
  const selected3dMarker = page.getByRole('img', { name: `Selected map location: ${address}` });
  await expect(selected3dMarker).toBeVisible({ timeout: 20000 });
  await expect.poll(async () => {
    const mapBox = await page.locator('.maplibregl-map').boundingBox();
    const markerBox = await selected3dMarker.boundingBox();
    if (!mapBox || !markerBox) return false;
    return Math.abs(markerBox.x + markerBox.width / 2 - (mapBox.x + mapBox.width / 2)) < 5
      && Math.abs(markerBox.y + markerBox.height - (mapBox.y + mapBox.height / 2)) < 5;
  }).toBe(true);

  const twoDButton = page.getByRole('button', { name: '2D', exact: true });
  if (!await twoDButton.isVisible()) await page.locator('.map-tools summary').click();
  await twoDButton.click();
  await expect(page.locator('section[aria-label="Movable OpenStreetMap view"]')).toBeVisible();
  await expectLeafletMarkerAtMapCenter(page, address);
});

test('locating a home takes camera priority, address recenter restores it, and Singapore reset clears it', async ({ page }) => {
  await installApiRoutes(page);
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto('/explore');
  await expect(page.getByRole('button', { name: 'Show 123 Toa Payoh Central on map', exact: true })).toBeVisible();
  await chooseAddress(page);
  await expectLeafletMarkerAtMapCenter(page, address);

  await page.getByRole('button', { name: 'Show 123 Toa Payoh Central on map', exact: true }).click();
  const map = await page.locator('.leaflet-container').boundingBox();
  const homeMarker = page.locator('.leaflet-marker-icon .map-marker.selected');
  await expect(homeMarker).toBeVisible();
  await expect.poll(async () => {
    const marker = await homeMarker.boundingBox();
    if (!marker || !map) return false;
    return marker.x >= map.x && marker.y >= map.y
      && marker.x + marker.width <= map.x + map.width
      && marker.y + marker.height <= map.y + map.height;
  }).toBe(true);

  await page.getByRole('button', { name: `Show ${address} on map again` }).click();
  await expectLeafletMarkerAtMapCenter(page, address);
  const reset = page.getByRole('button', { name: 'Center map on Singapore' });
  if (!await reset.isVisible()) await page.locator('.map-tools summary').click();
  await reset.click();
  await expect(page.locator(`.leaflet-marker-icon[title="Selected map location: ${address}"]`)).toHaveCount(0);
  await expect(page.getByRole('button', { name: `Show ${address} on map again` })).toHaveCount(0);
});

test('an unavailable 3D style falls back to 2D with the selected address retained', async ({ page }) => {
  await installApiRoutes(page);
  await page.route('https://tiles.openfreemap.org/styles/bright', route => route.abort());
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto('/explore');
  await chooseAddress(page);
  await expectLeafletMarkerAtMapCenter(page, address);
  await page.locator('.map-tools summary').click();
  await page.getByRole('button', { name: '3D', exact: true }).click();

  await expect(page.locator('section[aria-label="Movable OpenStreetMap view"]')).toBeVisible({ timeout: 20000 });
  await expect(page.getByText(/3D map|3D is unavailable|free 3D/i).last()).toBeVisible();
  await expectLeafletMarkerAtMapCenter(page, address);
  await expect(page.getByRole('button', { name: `Show ${address} on map again` })).toBeVisible();
});
