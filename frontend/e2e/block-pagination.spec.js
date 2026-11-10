import { test, expect } from '@playwright/test';

const apiOrigin = process.env.PLAYWRIGHT_LIVE_SCORING_API_URL;

test('best-fit block pages and all-transaction pages both load more successfully', async ({ page }) => {
  test.skip(!apiOrigin, 'Set PLAYWRIGHT_LIVE_SCORING_API_URL to a populated scoring backend.');
  test.setTimeout(120000);
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.route('**/api/v1/**', async route => {
    const url = new URL(route.request().url());
    if (url.pathname === '/api/v1/homes' || url.pathname === '/api/v1/search') {
      const response = await route.fetch({ url: `${apiOrigin}${url.pathname}${url.search}` });
      return route.fulfill({ response });
    }
    return route.fulfill({ json: url.pathname === '/api/v1/auth/session' ? { user: null } : { items: [], features: [], counts: [], towns: [], flatTypes: [] } });
  });
  await page.route('https://*.tile.openstreetmap.org/**', route => route.abort());
  await page.goto('/explore?search=1&weight_school=1&weight_childcare=1&weight_care=1&weight_affordability=1');
  const cards = page.locator('article[data-home-id]');
  await expect(page.getByText(/^50 of [\d,]+ blocks loaded$/)).toBeVisible({ timeout: 30000 });
  await expect(cards).toHaveCount(50);
  await page.getByRole('button', { name: 'Load more blocks', exact: true }).click();
  await expect(page.getByText(/^100 of [\d,]+ blocks loaded$/)).toBeVisible({ timeout: 30000 });
  await expect(cards).toHaveCount(100);
  const ids = await cards.evaluateAll(elements => elements.map(element => element.dataset.homeId));
  expect(new Set(ids).size).toBe(100);
  await expect(page.getByText('Update failed; showing previous results', { exact: true })).toHaveCount(0);

  await page.locator('.explore-sort > summary').click();
  await page.getByRole('checkbox', { name: 'One best-fit record per block' }).click();
  await expect(page.getByText(/^50 of [\d,]+ records loaded$/)).toBeVisible({ timeout: 30000 });
  await expect(cards).toHaveCount(50);
  await page.getByRole('button', { name: 'Load more transactions', exact: true }).click();
  await expect(page.getByText(/^100 of [\d,]+ records loaded$/)).toBeVisible({ timeout: 30000 });
  await expect(cards).toHaveCount(100);
  await expect(page.getByText('Update failed; showing previous results', { exact: true })).toHaveCount(0);
});
