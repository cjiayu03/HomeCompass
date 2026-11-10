import { expect, test } from '@playwright/test';

test.use({
  reducedMotion: 'reduce',
  launchOptions: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH
    ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] }
    : { args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] },
});

const NEA_URL = 'https://www.nea.gov.sg/dengue-zika/dengue/dengue-clusters';

function snapshotPolicy({ updatedAt, checkedAt, state = 'fresh', rows = 2 }) {
  return {
    state,
    fresh: state === 'fresh',
    usable: state === 'fresh',
    complete: true,
    coverage: 'complete',
    rows,
    rejected: 0,
    sourceUpdatedAt: updatedAt,
    validUntil: new Date(Date.parse(updatedAt) + 48 * 60 * 60 * 1000).toISOString(),
    checkedAt,
    sourceUrl: NEA_URL,
    datasetUrl: 'https://data.gov.sg/datasets/d_dbfabf16158d1b0e1c420627c0819168/view',
    reason: state === 'stale'
      ? "The NEA active-cluster snapshot is older than the app's 48-hour display window."
      : 'The complete national NEA active-cluster export is within the app\'s 48-hour display window.',
  };
}

function homeRecord({ id, address, lat, lng, dengue }) {
  return {
    id, address, town: 'BISHAN', type: '4 ROOM', price: 510000,
    lat, lng, geocodeStatus: 'resolved', geocodeSource: 'OneMap',
    source: 'data.gov.sg · hdb-resale', sourceUpdated: '2026-09-01',
    sourceSemantics: 'historical_transaction', observedOn: '2024-06-03',
    score: null, risks: ['Historical resale transaction; not a current listing'],
    dengue, risk: 'No published cluster overlap',
  };
}

function clusterFeature({ id, name, count, ring, sourceUpdatedAt, recordUpdatedAt }) {
  return {
    type: 'Feature', id,
    geometry: { type: 'Polygon', coordinates: [ring] },
    properties: {
      name, resourceType: 'dengue_cluster', caseCount: count,
      alertLevel: count >= 10 ? 'red' : 'yellow',
      categoryLabel: count >= 10 ? 'High-risk cluster (10 or more cases)' : 'High-risk cluster (fewer than 10 cases)',
      sourceUpdatedAt, recordUpdatedAt, sourceUrl: 'https://data.gov.sg/datasets/d_dbfabf16158d1b0e1c420627c0819168/view',
      sourceVersion: sourceUpdatedAt, retrievedAt: sourceUpdatedAt,
    },
  };
}

async function installApi(page, { homes, policy, features }) {
  const counts = [{ resourceType: 'dengue_cluster', total: policy.rows, unlocated: 0 }];
  const source = {
    sourceId: 'd_dbfabf16158d1b0e1c420627c0819168',
    resourceType: 'dengue_cluster',
    url: 'https://data.gov.sg/datasets/d_dbfabf16158d1b0e1c420627c0819168/view',
    state: 'valid', rows: policy.rows, rejected: 0,
    sourceUpdatedAt: policy.sourceUpdatedAt,
    retrievedAt: policy.checkedAt,
    dengue: policy,
  };

  await page.route('**/api/v1/**', async route => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    const query = new URL(request.url()).searchParams;
    let payload;
    if (path === '/api/v1/auth/session') payload = { user: null };
    else if (path === '/api/v1/homes' || path === '/api/v1/search') {
      payload = { items: homes, count: homes.length, total: homes.length, hasMore: false, dataMode: 'live', sourceSummary: [], warnings: [] };
    } else if (path === '/api/v1/search/options') payload = { towns: ['BISHAN'], flatTypes: ['4 ROOM'] };
    else if (path === '/api/v1/sources') payload = { items: [source], imported: 1, registered: 1, state: 'available' };
    else if (path === '/api/v1/resources') {
      const requested = query.get('resource_type');
      payload = {
        type: 'FeatureCollection',
        features: requested === 'dengue_cluster' ? features : [],
        count: requested === 'dengue_cluster' ? features.length : 0,
        counts,
        dengue: policy,
        dataMode: 'live',
        retrievedAt: policy.checkedAt,
      };
    } else payload = { items: [], features: [] };
    return route.fulfill({ status: 200, json: payload });
  });
  await page.route('https://*.tile.openstreetmap.org/**', route => route.abort());
}

async function mockMapLibreTiles(page) {
  await page.route('https://tiles.openfreemap.org/styles/bright', route => route.fulfill({
    json: { version: 8, sources: {}, layers: [{ id: 'background', type: 'background', paint: { 'background-color': '#eef0e9' } }] },
  }));
  await page.route('https://tiles.openfreemap.org/planet', route => route.fulfill({
    json: { tilejson: '3.0.0', tiles: ['https://map.example.test/planet/{z}/{x}/{y}.pbf'], minzoom: 0, maxzoom: 14, vector_layers: [{ id: 'building', fields: { render_height: 'Number', render_min_height: 'Number', hide_3d: 'Boolean' } }] },
  }));
  await page.route('https://map.example.test/**', route => route.fulfill({ contentType: 'application/x-protobuf', body: '' }));
}

test('fresh red/yellow polygons, no-overlap wording, popups and both map renderers', async ({ page }, testInfo) => {
  const checkedAt = new Date().toISOString();
  const sourceUpdatedAt = new Date(Date.now() - 60 * 60 * 1000).toISOString();
  const policy = snapshotPolicy({ updatedAt: sourceUpdatedAt, checkedAt, rows: 2 });
  const homes = [
    homeRecord({
      id: 'red-home', address: '12 Bishan Street 12', lat: 1.33, lng: 103.84,
      dengue: { state: 'active_cluster', severity: 'red', caseCount: 18, locality: 'Bishan Street 12', sourceUpdatedAt, retrievedAt: checkedAt, checkedAt, validUntil: policy.validUntil, sourceUrl: NEA_URL, coverage: 'complete', reason: 'Verified NEA cluster overlap.' },
    }),
    homeRecord({
      id: 'yellow-home', address: '22 Bishan Street 12', lat: 1.34, lng: 103.85,
      dengue: { state: 'active_cluster', severity: 'yellow', caseCount: 4, locality: 'Bishan Street 12', sourceUpdatedAt, retrievedAt: checkedAt, checkedAt, validUntil: policy.validUntil, sourceUrl: NEA_URL, coverage: 'complete', reason: 'Verified NEA cluster overlap.' },
    }),
    homeRecord({
      id: 'outside-home', address: '32 Bishan Street 12', lat: 1.35, lng: 103.86,
      dengue: { state: 'no_active_cluster', sourceUpdatedAt, retrievedAt: checkedAt, checkedAt, validUntil: policy.validUntil, sourceUrl: NEA_URL, coverage: 'complete', reason: 'No active polygon overlap in the complete snapshot.' },
    }),
  ];
  const features = [
    clusterFeature({ id: 'nea-red', name: 'Bishan Street 12', count: 18, sourceUpdatedAt, recordUpdatedAt: '2026-10-27T09:50:46+00:00', ring: [[103.83, 1.322], [103.85, 1.322], [103.85, 1.338], [103.83, 1.338], [103.83, 1.322]] }),
    clusterFeature({ id: 'nea-yellow', name: 'Bishan Street 22', count: 4, sourceUpdatedAt, recordUpdatedAt: '2026-10-27T10:10:00+00:00', ring: [[103.841, 1.333], [103.86, 1.333], [103.86, 1.349], [103.841, 1.349], [103.841, 1.333]] }),
  ];
  await installApi(page, { homes, policy, features });
  await mockMapLibreTiles(page);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/explore');
  const results = page.getByRole('region', { name: 'Historical transaction results' });
  await expect(results.getByText(/Red: NEA high-risk cluster/)).toBeVisible();
  await expect(results.getByText(/Yellow: NEA high-risk cluster/)).toBeVisible();
  await expect(results.getByText('No active NEA cluster polygon overlap')).toBeVisible();
  await expect(results.getByText('This does not mean there is no dengue risk.')).toBeVisible();

  await page.getByLabel('Map options', { exact: true }).first().click();
  const dengueLayer = page.getByRole('checkbox', { name: /Dengue clusters/ });
  await expect(dengueLayer).toBeEnabled();
  await dengueLayer.check();
  const legend = page.getByRole('region', { name: 'NEA dengue map legend' });
  await expect(legend).toContainText('Red · 10+ cases');
  await expect(legend).toContainText('Yellow · 2–9 cases');
  await expect(legend).toHaveAttribute('data-state', 'fresh');

  const polygons = page.locator('.leaflet-overlay-pane path.leaflet-interactive');
  await expect(polygons).toHaveCount(2);
  const fills = await polygons.evaluateAll(nodes => nodes.map(node => node.getAttribute('fill')));
  expect(fills).toContain('#c4514e');
  expect(fills).toContain('#c49a3f');
  await page.getByLabel('Map options', { exact: true }).first().click();
  await page.screenshot({ path: testInfo.outputPath('fresh-dengue-desktop-2d.png'), fullPage: true });
  const redPolygon = page.locator('.leaflet-overlay-pane path[fill="#c4514e"]');
  const polygonBox = await redPolygon.boundingBox();
  await page.mouse.click(polygonBox.x + 6, polygonBox.y + 6);
  const popup = page.locator('.leaflet-popup-content');
  await expect(popup).toContainText('18 cases');
  await expect(popup.getByText('Red alert', { exact: true })).toBeVisible();
  const recordNote = popup.getByText(/Record updated/);
  await expect(recordNote).not.toBeVisible();
  await popup.getByText('Data details', { exact: true }).click();
  await expect(recordNote).toBeVisible();
  await expect(recordNote).toContainText('This is not a case report date');
  await popup.getByText('Data details', { exact: true }).click();
  await expect(popup.getByRole('link', { name: 'Open official NEA cluster map' })).toHaveAttribute('href', NEA_URL);

  await page.locator('.leaflet-marker-icon[title="12 Bishan Street 12"]').click({ force: true });
  await expect(page.locator('.map-marker.selected')).toHaveCount(1);
  await page.getByLabel('Map options', { exact: true }).first().click();
  await page.getByRole('button', { name: '3D', exact: true }).click();
  await page.getByLabel('Map options', { exact: true }).first().click();
  await expect(page.locator('.maplibregl-canvas')).toBeVisible({ timeout: 20000 });
  await expect(legend).toHaveAttribute('data-state', 'fresh');
  await page.screenshot({ path: testInfo.outputPath('fresh-dengue-desktop-3d.png'), fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole('button', { name: 'Map', exact: true }).click();
  await page.getByRole('button', { name: 'Close record details' }).click();
  await expect(legend).toBeVisible();
  const homeSummary = page.getByTestId('selected-home-map-summary');
  await expect(homeSummary).toBeVisible();
  const legendBox = await legend.boundingBox();
  const homeSummaryBox = await homeSummary.boundingBox();
  expect(legendBox.x + legendBox.width <= homeSummaryBox.x
    || homeSummaryBox.x + homeSummaryBox.width <= legendBox.x
    || legendBox.y + legendBox.height <= homeSummaryBox.y
    || homeSummaryBox.y + homeSummaryBox.height <= legendBox.y).toBe(true);
  await page.screenshot({ path: testInfo.outputPath('fresh-dengue-mobile.png'), fullPage: true });
});

test.describe('touch mobile cluster details', () => {
  test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });

  test('expanded details keep the title and source inside the map', async ({ page }) => {
    const checkedAt = new Date().toISOString();
    const sourceUpdatedAt = new Date(Date.now() - 60 * 60 * 1000).toISOString();
    const policy = snapshotPolicy({ updatedAt: sourceUpdatedAt, checkedAt, rows: 1 });
    const home = homeRecord({ id: 'mobile-home', address: '105 BISHAN ST 12', lat: 1.33, lng: 103.84 });
    const feature = clusterFeature({ id: 'mobile-red', name: 'Bishan Street 12', count: 18, sourceUpdatedAt, recordUpdatedAt: '2026-10-27T09:50:46+00:00', ring: [[103.833, 1.325], [103.847, 1.325], [103.847, 1.335], [103.833, 1.335], [103.833, 1.325]] });
    await installApi(page, { homes: [home], policy, features: [feature] });
    await page.goto('/explore');
    await page.getByRole('button', { name: 'Map', exact: true }).click();
    await page.getByLabel('Map options', { exact: true }).first().click();
    await page.getByRole('checkbox', { name: /Dengue clusters/ }).check();
    await page.getByLabel('Map options', { exact: true }).first().click();
    const polygon = page.locator('.leaflet-overlay-pane path[fill="#c4514e"]');
    await expect(polygon).toBeVisible();
    const polygonBox = await polygon.boundingBox();
    await page.mouse.click(polygonBox.x + 15, polygonBox.y + polygonBox.height / 2);
    const popup = page.locator('.leaflet-popup');
    await popup.getByText('Data details', { exact: true }).click();
    await expect(popup.locator('details')).toHaveAttribute('open', '');
    await expect(popup.getByText('18 cases', { exact: true })).toBeVisible();
    await expect(popup.getByRole('link', { name: 'Open official NEA cluster map' })).toBeVisible();
    await expect.poll(async () => {
      const box = await popup.boundingBox();
      const controls = await page.locator('.map-tools').boundingBox();
      const legend = await page.getByRole('region', { name: 'NEA dengue map legend' }).boundingBox();
      return box.y >= controls.y + controls.height && box.y + box.height <= legend.y
        && box.x >= 0 && box.x + box.width <= 390;
    }).toBe(true);
  });
});

test('stale API polygons and cached risk text stay hidden', async ({ page }, testInfo) => {
  const checkedAt = new Date().toISOString();
  const sourceUpdatedAt = new Date(Date.now() - 72 * 60 * 60 * 1000).toISOString();
  const policy = snapshotPolicy({ updatedAt: sourceUpdatedAt, checkedAt, state: 'stale', rows: 1 });
  const home = homeRecord({
    id: 'stale-home', address: '12 Old Cluster Road', lat: 1.33, lng: 103.84,
    risk: 'No published cluster overlap',
    dengue: { state: 'stale', sourceUpdatedAt, retrievedAt: checkedAt, checkedAt, validUntil: policy.validUntil, sourceUrl: NEA_URL, coverage: 'unavailable', reason: 'The NEA snapshot is stale.' },
  });
  const oldFeature = clusterFeature({ id: 'old-red', name: 'Old Cluster Road', count: 18, sourceUpdatedAt, recordUpdatedAt: '2025-10-27T09:50:46+00:00', ring: [[103.838, 1.328], [103.842, 1.328], [103.842, 1.332], [103.838, 1.332], [103.838, 1.328]] });
  await installApi(page, { homes: [home], policy, features: [oldFeature] });
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto('/explore');

  await expect(page.getByRole('region', { name: 'Historical transaction results' })).toContainText('NEA cluster snapshot is stale; status hidden');
  await expect(page.getByRole('region', { name: 'Historical transaction results' })).not.toContainText('No published cluster overlap');
  await page.getByLabel('Map options', { exact: true }).first().click();
  await page.getByRole('checkbox', { name: /Dengue clusters/ }).check();
  const legend = page.getByRole('region', { name: 'NEA dengue map legend' });
  await expect(legend).toHaveAttribute('data-state', 'stale');
  await expect(legend).toContainText('Data expired. Overlay hidden.');
  await expect(page.locator('.leaflet-overlay-pane path[fill="#c4514e"]')).toHaveCount(0);
  await page.screenshot({ path: testInfo.outputPath('stale-dengue-hidden.png'), fullPage: true });
});
