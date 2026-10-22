import { expect, test } from '@playwright/test';

test.use({
  reducedMotion: 'reduce',
  launchOptions: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH
    ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] }
    : { args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] },
});

test.beforeEach(async ({ page }) => {
  const items = Array.from({ length: 12 }, (_, index) => ({
    id: `layout-home-${index}`, address: `${123 + index} Toa Payoh Central`,
    town: 'Toa Payoh', type: '4-room', price: 540000, floorAreaSqm: 93,
    storeyRange: '04 TO 06', remainingLeaseYears: 65,
    source: 'data.gov.sg · hdb-resale', sourceUpdated: '2026-09-01',
    observedOn: '2024-06-03', sourceSemantics: 'historical_transaction',
    geocodeStatus: 'resolved', lat: index === 1 ? 1.42 : 1.335, lng: index === 1 ? 103.96 : 103.849,
    highlights: [], risks: ['Historical transaction, not a listing'],
  }));
  await page.route('**/api/v1/**', async (route) => {
    const path = new URL(route.request().url()).pathname;
    let payload;
    if (path === '/api/v1/homes' || path === '/api/v1/search') {
      payload = { items, count: items.length, total: items.length, hasMore: false,
        dataMode: 'live', warnings: ['Some records lack service-distance evidence.'] };
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
  await page.route('https://*.tile.openstreetmap.org/**', (route) => route.abort());
});

for (const viewport of [{ width: 1366, height: 768 }, { width: 1280, height: 650 }, { width: 390, height: 844 }]) {
  test(`a complete result is visible without scrolling at ${viewport.width}px`, async ({ page }) => {
    await page.setViewportSize(viewport);
    await page.goto('/explore');
    const card = page.locator('section[aria-label="Candidate places"] article').first();
    await expect(card).toBeVisible();
    const rect = await card.boundingBox();
    expect(rect.y + rect.height).toBeLessThan(viewport.height);
    expect(rect.height).toBeLessThan(380);
    for (const button of await card.getByRole('button').all()) {
      const target = await button.boundingBox();
      expect(target.height).toBeGreaterThanOrEqual(44);
      expect(target.width).toBeGreaterThanOrEqual(44);
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await card.getByRole('button', { name: 'Details', exact: true }).click();
    await expect(page.getByRole('dialog').getByRole('heading', { name: 'Household access' })).toBeVisible();
    await page.keyboard.press('Escape');
    await page.getByRole('button', { name: 'Search tools', exact: true }).click();
    await expect(page.getByRole('dialog').getByText('Some records lack service-distance evidence.')).toBeVisible();
    await page.keyboard.press('Escape');
    await page.getByRole('button', { name: 'Filters', exact: true }).click();
    await expect(page.getByRole('dialog').getByRole('heading', { name: 'Filters', exact: true })).toBeVisible();
    await page.keyboard.press('Escape');
    if (viewport.width < 1024) {
      await page.getByRole('button', { name: 'Map', exact: true }).click();
      await expect(page.locator('section[aria-label="Movable OpenStreetMap view"]')).toBeVisible();
      await page.getByRole('button', { name: /^Homes \(/ }).click();
      await expect(card).toBeVisible();
    }
  });
}

test('hover and keyboard focus locate a result without selecting it', async ({ page }) => {
  await page.setViewportSize({ width: 1366, height: 768 });
  await page.goto('/explore');
  const card = page.locator('section[aria-label="Candidate places"] article').first();
  await expect(card).toBeVisible();
  await expect(page.locator('.leaflet-marker-icon').first()).toBeVisible();
  await card.hover();
  const label = page.locator('.home-hover-label');
  await expect(label).toContainText('123 Toa Payoh Central');
  await expect(page.locator('.map-marker.hovered')).toHaveCount(1);
  await expect(page.locator('.map-marker.selected')).toHaveCount(0);
  await page.getByRole('heading', { name: 'Explore homes' }).hover();
  await expect(label).toHaveCount(0);
  await card.getByRole('button', { name: 'Details', exact: true }).focus();
  await expect(label).toContainText('123 Toa Payoh Central');
  await page.getByRole('button', { name: 'Search tools', exact: true }).focus();
  await expect(label).toHaveCount(0);
  const secondCard = page.locator('section[aria-label="Candidate places"] article').nth(1);
  await secondCard.hover();
  await expect(label).toContainText('124 Toa Payoh Central');
  await expect(page.locator('.map-marker.hovered')).toHaveCount(1);
});

test('popups are opaque and unblurred; Explore uses a solid background', async ({ page }) => {
  await page.goto('/explore');
  await expect(page.locator('section[aria-label="Candidate places"] article').first()).toBeVisible();
  expect(await page.locator('.workspace-canvas').evaluate(el => getComputedStyle(el, '::before').animationName)).toBe('none');
  for (const name of ['Filters', 'Search tools']) {
    await page.getByRole('button', { name, exact: true }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();
    const styles = await dialog.evaluate(el => ({
      content: getComputedStyle(el).backdropFilter,
      overlay: getComputedStyle(el.previousElementSibling).backdropFilter,
      background: getComputedStyle(el).backgroundColor,
    }));
    expect(styles.content).toBe('none');
    expect(styles.overlay).toBe('none');
    expect(styles.background).not.toContain('rgba');
    await page.keyboard.press('Escape');
  }
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  expect(await page.locator('.workspace-canvas').evaluate(el => ({
    background: getComputedStyle(el).backgroundImage,
    decoration: getComputedStyle(el, '::before').display,
  }))).toEqual({ background: 'none', decoration: 'none' });
  expect(await page.locator('.explore-workspace').evaluate(el =>
    [el, ...el.querySelectorAll('*')].filter(node =>
      getComputedStyle(node).backgroundImage.includes('gradient')).length,
  )).toBe(0);
});

test('map clicks reveal the matching card without adding it to Compare', async ({ page }) => {
  await page.setViewportSize({ width: 1366, height: 768 });
  await page.goto('/explore');
  const marker = page.locator('.leaflet-marker-icon').last();
  await expect(marker).toBeAttached();
  await marker.dispatchEvent('click');
  const active = page.locator('article[data-map-active="true"]');
  await expect(active).toHaveAttribute('data-home-id', 'layout-home-11');
  await expect(active).toHaveAttribute('aria-current', 'location');
  await expect(active.getByRole('button', { name: 'Compare', exact: true })).toHaveAttribute('aria-pressed', 'false');
  const list = active.locator('..').locator('..');
  await expect.poll(() => list.evaluate(el => el.scrollTop)).toBeGreaterThan(0);
  const cardBox = await active.boundingBox();
  const listBox = await list.boundingBox();
  expect(cardBox.y).toBeGreaterThanOrEqual(listBox.y);
  expect(cardBox.y + cardBox.height).toBeLessThanOrEqual(listBox.y + listBox.height);
  await page.getByRole('button', { name: 'Show 123 Toa Payoh Central on map', exact: true }).click();
  await expect(page.locator('article[data-map-active="true"]')).toHaveAttribute('data-home-id', 'layout-home-0');
  await expect(page.locator('.map-marker.selected')).toHaveCount(1);
});

test('mobile map selection opens the matching home card', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/explore');
  await page.getByRole('button', { name: 'Map', exact: true }).click();
  const marker = page.locator('.leaflet-marker-icon').last();
  await expect(marker).toBeAttached();
  await marker.dispatchEvent('click');
  await expect(page.getByRole('button', { name: /^Homes \(/ })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('article[data-map-active="true"]')).toHaveAttribute('data-home-id', 'layout-home-11');
});

test('the SVG compass animates during a real pending request and stops for reduced motion', async ({ page }) => {
  let release;
  const pending = new Promise(resolve => { release = resolve; });
  await page.route('**/api/v1/homes', async route => { await pending; await route.fallback(); });
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await page.goto('/explore');
  try {
    const loader = page.locator('.loading-scene').filter({ hasText: 'Loading data' }).first();
    await expect(loader).toBeVisible();
    const orbit = loader.locator('.loading-compass-orbit').first();
    expect(await orbit.evaluate(el => getComputedStyle(el).animationName)).toBe('compass-orbit');
    const firstFrame = await orbit.evaluate(el => getComputedStyle(el).transform);
    await expect.poll(() => orbit.evaluate(el => getComputedStyle(el).transform)).not.toBe(firstFrame);
    await page.emulateMedia({ reducedMotion: 'reduce' });
    expect(await orbit.evaluate(el => getComputedStyle(el).animationName)).toBe('none');
  } finally { release(); }
  await expect(page.locator('article[data-home-id="layout-home-0"]')).toBeVisible();
});

test('3D marker selection and popup contrast work in both themes', async ({ page }) => {
  await page.setViewportSize({ width: 1366, height: 900 });
  await page.route('**/api/v1/homes', route => route.fulfill({ json: {
    items: [{ id: 'three-d-home', address: '3D test home', town: 'Toa Payoh', type: '4-room',
      price: 540000, lat: 1.335, lng: 103.849, source: 'data.gov.sg', sourceUpdated: '2026-09-01',
      sourceSemantics: 'historical_transaction', highlights: [], risks: [] }],
    total: 1, count: 1, hasMore: false, dataMode: 'live',
  } }));
  await page.route('https://tiles.openfreemap.org/styles/**', route => route.fulfill({ json: {
    version: 8, sources: {}, layers: [{ id: 'background', type: 'background', paint: { 'background-color': '#e7eee9' } }],
  } }));
  await page.route('https://tiles.openfreemap.org/planet', route => route.fulfill({ json: {
    tilejson: '3.0.0', tiles: ['https://map.example.test/{z}/{x}/{y}.pbf'], minzoom: 0, maxzoom: 14,
    vector_layers: [{ id: 'building', fields: {} }],
  } }));
  await page.route('https://map.example.test/**', route => route.fulfill({ contentType: 'application/x-protobuf', body: '' }));
  await page.goto('/explore');
  await expect(page.locator('article[data-home-id="three-d-home"]')).toBeVisible();
  await page.getByRole('button', { name: '3D', exact: true }).click();
  const canvas = page.locator('.maplibregl-canvas');
  await expect(canvas).toBeVisible({ timeout: 20000 });
  await expect(page.getByText('Building your 3D neighbourhood…', { exact: true })).toHaveCount(0, { timeout: 20000 });
  const box = await canvas.boundingBox();
  await canvas.click({ position: { x: box.width / 2, y: box.height / 2 } });
  await expect(page.locator('article[data-map-active="true"]')).toHaveAttribute('data-home-id', 'three-d-home');
  const popup = page.locator('.maplibregl-popup-content').first();
  await expect(popup).toContainText('3D test home');
  for (const theme of ['dark', 'light']) {
    await page.getByRole('button', { name: `Use ${theme} theme` }).click();
    const colours = await popup.evaluate(el => ({ bg: getComputedStyle(el).backgroundColor, fg: getComputedStyle(el).color }));
    const rgb = value => value.match(/\d+/g).slice(0, 3).map(Number).map(value => {
      const channel = value / 255; return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
    }).reduce((sum, value, index) => sum + value * [0.2126, 0.7152, 0.0722][index], 0);
    const levels = [rgb(colours.bg), rgb(colours.fg)].sort((a, b) => a - b);
    expect((levels[1] + 0.05) / (levels[0] + 0.05)).toBeGreaterThanOrEqual(4.5);
  }
});
