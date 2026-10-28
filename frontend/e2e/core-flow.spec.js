import { expect, test } from '@playwright/test';

const retrievedAt = '2026-10-18T12:00:00+00:00';
const sourceSummary = [
  {
    sourceId: 'hdb-resale',
    sourceVersion: '2026-09',
    retrievedAt,
  },
];

const historicalHomes = [
  {
    id: 'hdb-toa-payoh-2024-06',
    address: '123 Toa Payoh Central',
    town: 'Toa Payoh',
    type: '4-room',
    price: 540000,
    score: 76.4,
    scoreDetails: {
      coverage: 0.8,
      components: [
        { name: 'school', normalizedValue: 84, weight: 2, contribution: 33.6, evidenceStatus: 'available' },
        { name: 'childcare', normalizedValue: 80, weight: 2, contribution: 32, evidenceStatus: 'available' },
        { name: 'care', normalizedValue: null, weight: 2, contribution: null, evidenceStatus: 'missing' },
        { name: 'affordability', normalizedValue: 75, weight: 1, contribution: 10.8, evidenceStatus: 'available' },
      ],
      missingEvidence: ['care'],
      policyVersion: 'home-fit-v1',
      scoredAt: retrievedAt,
    },
    lat: 1.335,
    lng: 103.849,
    source: 'data.gov.sg · hdb-resale',
    sourceUpdated: '2026-09',
    sourceSemantics: 'historical_transaction',
    geocodeSource: 'OneMap',
    geocodedAt: '2026-10-10T09:00:00+00:00',
    geocodeStatus: 'resolved',
    school: 'School access recorded in source snapshot',
    childcare: 'Childcare access recorded in source snapshot',
    care: null,
    risk: 'No published cluster overlap',
    highlights: [],
    risks: ['Historical resale transaction; not a current listing'],
    observedOn: '2024-06-03',
    floorAreaSqm: 93,
  },
  {
    id: 'hdb-toa-payoh-2024-07',
    address: '88 Lorong 2 Toa Payoh',
    town: 'Toa Payoh',
    type: '3-room',
    price: 415000,
    score: null,
    scoreDetails: {
      coverage: 0.14,
      components: [
        { name: 'school', normalizedValue: null, weight: 2, contribution: null, evidenceStatus: 'missing' },
        { name: 'childcare', normalizedValue: null, weight: 2, contribution: null, evidenceStatus: 'missing' },
        { name: 'care', normalizedValue: null, weight: 2, contribution: null, evidenceStatus: 'missing' },
        { name: 'affordability', normalizedValue: 72, weight: 1, contribution: 14, evidenceStatus: 'available' },
      ],
      missingEvidence: ['school', 'childcare', 'care'],
      policyVersion: 'home-fit-v1',
      scoredAt: retrievedAt,
    },
    lat: 1.337,
    lng: 103.847,
    source: 'data.gov.sg · hdb-resale',
    sourceUpdated: '2026-09',
    sourceSemantics: 'historical_transaction',
    geocodeSource: null,
    geocodedAt: null,
    geocodeStatus: 'pending',
    school: null,
    childcare: null,
    care: null,
    risk: 'Location needed for cluster check',
    highlights: [],
    risks: ['Historical resale transaction; not a current listing'],
    observedOn: '2024-07-19',
    floorAreaSqm: 68,
  },
];

function homeEnvelope(items) {
  return {
    items,
    count: items.length,
    total: items.length,
    nextCursor: null,
    hasMore: false,
    dataMode: 'live',
    retrievedAt,
    sourceSummary,
    warnings: ['Historical resale records are not current listings.'],
  };
}

const resourcePayload = {
  type: 'FeatureCollection',
  features: [
    {
      type: 'Feature',
      id: 'silver-zone-toa-payoh',
      geometry: { type: 'Point', coordinates: [103.849, 1.335] },
      properties: {
        name: 'Toa Payoh Silver Zone',
        resourceType: 'silver_zone',
        status: 'active',
        attributes: { description: 'Silver Zone source record' },
        sourceId: 'silver-zone-source',
        sourceUrl: 'https://data.gov.sg/',
        sourceVersion: '2026-09',
        retrievedAt,
        locationSourceId: null,
        locationRetrievedAt: null,
      },
    },
  ],
  count: 1,
  truncated: false,
  nextCursor: null,
  hasMore: false,
  counts: [{ resourceType: 'silver_zone', total: 1, unlocated: 0 }],
  dataMode: 'live',
  retrievedAt,
  sourceSummary: [{ sourceId: 'silver-zone-source', sourceVersion: '2026-09', retrievedAt }],
  warnings: [],
};

const sourcePayload = {
  items: [
    {
      sourceId: 'hdb-resale',
      resourceType: 'hdb_resale',
      url: 'https://data.gov.sg/',
      state: 'valid',
      rows: 2,
      rejected: 0,
      retrievedAt,
    },
    {
      sourceId: 'silver-zone-source',
      resourceType: 'silver_zone',
      url: 'https://data.gov.sg/',
      state: 'valid',
      rows: 1,
      rejected: 0,
      retrievedAt,
    },
  ],
  primaryDataset: 'hdb-resale',
  imported: 2,
  registered: 2,
  state: 'available',
};

test('guest researches dated homes, shortlists and compares them, then retries a failed search', async ({ page }) => {
  const requests = { homeCalls: 0, resourceCalls: 0, sourceCalls: 0, interpretTexts: [], searchBodies: [] };
  let failNextSearch = false;
  let retryWithHomes = false;

  await page.route('**/api/v1/**', async (route) => {
    const request = route.request();
    const pathname = new URL(request.url()).pathname;

    if (pathname === '/api/v1/homes' && request.method() === 'GET') {
      requests.homeCalls += 1;
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(homeEnvelope(retryWithHomes ? historicalHomes : [])),
      });
    }

    if (pathname === '/api/v1/resources') {
      requests.resourceCalls += 1;
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(resourcePayload) });
    }

    if (pathname === '/api/v1/sources') {
      requests.sourceCalls += 1;
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(sourcePayload) });
    }

    if (pathname === '/api/v1/ai/interpret' && request.method() === 'POST') {
      const body = request.postDataJSON();
      requests.interpretTexts.push(body.text);
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ filters: { query: body.text } }),
      });
    }

    if (pathname === '/api/v1/search' && request.method() === 'POST') {
      requests.searchBodies.push(request.postDataJSON());
      if (failNextSearch) {
        failNextSearch = false;
        return route.fulfill({
          status: 503,
          contentType: 'application/json',
          body: JSON.stringify({ detail: { code: 'SOURCE_UNAVAILABLE', message: 'Search source unavailable.' } }),
        });
      }

      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          ...homeEnvelope(historicalHomes),
          criteria: { query: 'Toa Payoh' },
          sourceSnapshotIds: ['snapshot-hdb-2026-09'],
          scorePolicyVersion: 'home-fit-v1',
          unappliedCriteria: [],
        }),
      });
    }

    return route.fulfill({ status: 404, contentType: 'application/json', body: JSON.stringify({ detail: 'Unmocked API request' }) });
  });

  await page.route('https://*.tile.openstreetmap.org/**', (route) => route.abort());

  await page.goto('/');
  await expect(page.getByRole('heading', { name: /find a place that fits/i })).toBeVisible();
  await page.getByRole('link', { name: /explore homes/i }).click();

  await expect(page.getByRole('heading', { name: 'Find an HDB area that fits.' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'No records match this search' })).toBeVisible();
  const candidates = page.getByRole('region', { name: 'Historical transaction results' });
  await expect(candidates).not.toContainText('Illustrative sample · not verified source data');
  await expect(candidates).not.toContainText('118 Jalan Bukit Merah');

  const map = page.getByRole('region', { name: 'Movable OpenStreetMap view' });
  await expect(map).toBeVisible();
  expect(requests.resourceCalls).toBeGreaterThan(0);
  expect(requests.sourceCalls).toBeGreaterThan(0);

  await page.getByRole('textbox', { name: 'Search a town, street or amenity' }).fill('Toa Payoh');
  await page.getByRole('button', { name: 'Search', exact: true }).click();

  const firstHome = page.getByRole('article', { name: /123 Toa Payoh Central/ });
  const secondHome = page.getByRole('article', { name: /88 Lorong 2 Toa Payoh/ });
  await expect(firstHome).toBeVisible();
  await expect(secondHome).toBeVisible();
  await expect(firstHome).toBeVisible();


  const firstEvidence = firstHome.getByRole('region', { name: 'Evidence context for 123 Toa Payoh Central' });
  await expect(firstEvidence).toContainText('Historical transaction · not a current listing');
  await firstEvidence.getByText('Source and location provenance').click();
  await expect(firstEvidence.getByText('Transaction date').locator('..')).toContainText('2024-06-03');
  await expect(firstEvidence.getByText('Source date').locator('..')).toContainText('2026-09');
  await expect(firstEvidence).toContainText('data.gov.sg · hdb-resale');
  await expect(firstEvidence).toContainText('76.4 / 100');
  await expect(firstEvidence).toContainText('Coverage 80%');
  await firstEvidence.getByRole('button', { name: /view score evidence/i }).click();
  await expect(firstEvidence.getByRole('heading', { name: 'Score evidence' })).toBeVisible();
  await expect(firstEvidence.getByRole('list', { name: 'Missing evidence' })).toContainText('Care access');

  await firstHome.getByRole('button', { name: 'Save 123 Toa Payoh Central to shortlist' }).click();
  await secondHome.getByRole('button', { name: 'Save 88 Lorong 2 Toa Payoh to shortlist' }).click();
  await page.getByRole('button', { name: /^Saved \(/ }).click();

  const savedFirst = page.getByRole('article', { name: /123 Toa Payoh Central/ });
  const savedSecond = page.getByRole('article', { name: /88 Lorong 2 Toa Payoh/ });
  await expect(savedFirst).toBeVisible();
  await expect(savedSecond).toBeVisible();
  await expect(savedFirst).toContainText('Historical transaction · not a current listing');
  await savedFirst.getByRole('button', { name: 'Compare' }).click();
  await savedSecond.getByRole('button', { name: 'Compare' }).click();
  await page.getByRole('button', { name: 'Compare 2', exact: true }).click();

  const comparison = page.getByRole('table', { name: 'Candidate evidence comparison' });
  await expect(comparison).toBeVisible();
  await expect(comparison).toContainText('123 Toa Payoh Central');
  await expect(comparison).toContainText('88 Lorong 2 Toa Payoh');
  const comparedFirst = comparison.getByRole('region', { name: 'Evidence context for 123 Toa Payoh Central' });
  await expect(comparedFirst).toContainText('Historical transaction · not a current listing');
  await comparedFirst.getByText('Source and location provenance').click();
  await expect(comparedFirst.getByText('Transaction date').locator('..')).toContainText('2024-06-03');
  await comparedFirst.getByRole('button', { name: /view score evidence/i }).click();
  await expect(comparedFirst.getByRole('heading', { name: 'Score evidence' })).toBeVisible();

  await page.getByRole('button', { name: 'Back to search', exact: true }).click();
  await page.getByRole('button', { name: 'All results', exact: true }).click();
  await page.getByRole('textbox', { name: 'Search a town, street or amenity' }).fill('Bedok');
  failNextSearch = true;
  await page.getByRole('button', { name: 'Search', exact: true }).click();

  const failedState = page.getByRole('alert').filter({ hasText: 'Update failed; showing previous results' });
  await expect(failedState).toBeVisible();
  await expect(failedState).toContainText('Search source unavailable.');
  await expect(page.getByRole('article', { name: /123 Toa Payoh Central/ })).toBeVisible();
  await expect(candidates).not.toContainText('Illustrative sample · not verified source data');

  retryWithHomes = true;
  await page.getByRole('button', { name: 'Retry home data' }).click();
  await expect(failedState).toHaveCount(0);
  await expect(page.getByRole('article', { name: /123 Toa Payoh Central/ })).toBeVisible();

  expect(requests.interpretTexts).toEqual(['Toa Payoh', 'Bedok']);
  expect(requests.searchBodies).toHaveLength(3);
  expect(requests.searchBodies[2]).toEqual(requests.searchBodies[1]);
  expect(requests.searchBodies[0].query).toBe('Toa Payoh');
  expect(requests.searchBodies[1].query).toBe('Bedok');
  expect(requests.homeCalls).toBe(1);
});
