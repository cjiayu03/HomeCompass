import { test, expect } from '@playwright/test';

for (const viewport of [{ width: 1440, height: 900 }, { width: 390, height: 844 }]) {
  test(`compact research desk and synchronized sidebar at ${viewport.width}px`, async ({ page }) => {
    await page.setViewportSize(viewport);
    const homes = Array.from({ length: 8 }, (_, index) => ({ id: `desk-${index}`, address: `${100 + index} Bedok North Road`, town: 'Bedok', type: '4-room', price: 500000 + index * 10000, lat: 1.32 + index * .003, lng: 103.92 + index * .002, source: 'HDB resale evidence', sourceUpdated: '2026-09', sourceSemantics: 'historical_transaction', observedOn: '2026-09-01', floorAreaSqm: 93, storeyRange: '04 TO 06', score: 72, risks: [], highlights: [] }));
    await page.route('**/api/v1/**', route => {
      const path = new URL(route.request().url()).pathname;
      const payload = path === '/api/v1/auth/session' ? { user: null } : path === '/api/v1/homes' || path === '/api/v1/search' ? { items: homes, count: homes.length, total: 8, dataMode: 'live', hasMore: false } : path === '/api/v1/resources' ? { features: [], dataMode: 'live' } : path === '/api/v1/search/options' ? { towns: ['Bedok'], flatTypes: ['4-room'] } : { items: [] };
      return route.fulfill({ json: payload });
    });
    await page.route('https://*.tile.openstreetmap.org/**', route => route.abort());
    await page.goto('/explore');
    const first = page.locator('article[data-home-id="desk-0"]');
    await expect(first).toBeVisible({ timeout: 15000 });
    await expect(page.getByRole('navigation', { name: 'Main navigation' })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollHeight <= innerHeight + 1)).toBe(true);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
    const stage = await page.locator('.explore-stage').boundingBox();
    expect(stage.y).toBeLessThan(viewport.height * .42);
    expect(stage.y + stage.height).toBeGreaterThan(viewport.height - 12);
    if (viewport.width >= 768) {
      const divider = page.getByRole('separator', { name: 'Resize map and sidebar' });
      const previousWidth = Number(await divider.getAttribute('aria-valuenow'));
      await divider.focus(); await page.keyboard.press('ArrowLeft');
      await expect(divider).toHaveAttribute('aria-valuenow', String(previousWidth + 24));
      const point = await divider.boundingBox();
      await page.mouse.move(point.x + point.width / 2, point.y + point.height / 2);
      await page.mouse.down(); await page.mouse.move(point.x - 40, point.y + point.height / 2); await page.mouse.up();
      expect(Number(await divider.getAttribute('aria-valuenow'))).toBeGreaterThan(previousWidth + 24);
    }
    await first.getByRole('button', { name: 'Details', exact: true }).click();
    const sidebar = page.locator('.explore-detail');
    await expect(sidebar).toBeVisible();
    await expect(sidebar.getByRole('heading', { name: '100 Bedok North Road', exact: true })).toBeVisible();
    await sidebar.getByRole('button', { name: 'Next record' }).click();
    await expect(sidebar.getByRole('heading', { name: '101 Bedok North Road', exact: true })).toBeVisible();
    await expect(page.locator('.map-marker.selected')).toHaveCount(1);
    await expect(page.locator('.leaflet-marker-icon[title="101 Bedok North Road"] .map-marker')).toHaveClass(/selected/);
    expect(await page.locator('.dialog-backdrop').count()).toBe(0);
    await sidebar.getByRole('button', { name: 'Close record details' }).click();
    await page.screenshot({ path: `/tmp/homecompass-split-${viewport.width}.png` });
    await page.getByRole('button', { name: 'Full map', exact: true }).click();
    await expect(page.locator('.explore-desk--map')).toBeVisible();
    const quickFilters = await page.locator('.explore-quick-filters').boundingBox();
    expect(quickFilters.y).toBeGreaterThan(viewport.height - 100);
    if (viewport.width >= 1200) {
      const brand = await page.locator('.explore-heading').boundingBox();
      const search = await page.locator('.explore-controls').boundingBox();
      expect(search.x).toBeGreaterThan(brand.x + brand.width);
    }
    const map = await page.locator('.explore-map').boundingBox();
    expect(map.height).toBeGreaterThan(viewport.height * .9);
    await page.getByRole('button', { name: 'Results', exact: true }).click();
    await expect(first).toBeVisible();
    await page.screenshot({ path: `/tmp/homecompass-desk-${viewport.width}.png` });
    await page.getByRole('button', { name: 'Split view', exact: true }).click();
    await expect(page.locator('.explore-desk--map')).toHaveCount(0);
  });
}
