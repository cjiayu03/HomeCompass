import { test, expect } from '@playwright/test';

for (const width of [1440, 390]) {
  test(`Saved supports direct edits, comparison and reversible removal at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    const homes = Array.from({ length: 3 }, (_, i) => ({ id: `saved-${i}`, address: `${100 + i} Bedok North Road`, town: 'Bedok', type: '4-room', price: 500000 + i * 10000, lat: 1.32, lng: 103.92, source: 'HDB resale evidence', sourceSemantics: 'historical_transaction', observedOn: '2026-09-01', floorAreaSqm: 93, remainingLeaseYears: 75, score: 72, risks: [], highlights: [] }));
    await page.addInitScript(records => {
      if (!sessionStorage.getItem('saved-test-seeded')) {
        localStorage.setItem('shortlist', JSON.stringify(records.map(home => home.id)));
        localStorage.setItem('homecompass.guest.decision-homes', JSON.stringify(records));
        sessionStorage.setItem('saved-test-seeded', 'true');
      }
    }, homes);
    await page.route('**/api/v1/**', route => {
      const path = new URL(route.request().url()).pathname;
      const payload = path === '/api/v1/auth/session' ? { user: null } : path === '/api/v1/homes' || path === '/api/v1/search' ? { items: homes, count: 3, total: 3, dataMode: 'live', hasMore: false } : path === '/api/v1/search/options' ? { towns: ['Bedok'], flatTypes: ['4-room'] } : { items: [], features: [] };
      return route.fulfill({ json: payload });
    });
    await page.goto('/shortlist');
    const rows = page.locator('[data-saved-home]');
    await expect(rows).toHaveCount(3);
    await rows.first().getByRole('textbox').fill('Check afternoon noise');
    await rows.first().getByRole('combobox').selectOption('visit');
    await page.getByRole('group', { name: 'Filter saved homes by stage' }).getByRole('button', { name: 'Plan a visit 1', exact: true }).click();
    await expect(rows).toHaveCount(1);
    await page.getByRole('group', { name: 'Filter saved homes by stage' }).getByRole('button', { name: 'All homes 3', exact: true }).click();
    await page.getByRole('button', { name: 'Group saved homes by stage' }).click();
    await expect(page.getByRole('heading', { name: /Plan a visit/ })).toBeVisible();
    await page.getByRole('button', { name: 'Group saved homes by stage' }).click();
    await rows.nth(0).getByRole('checkbox').check();
    await rows.nth(1).getByRole('checkbox').check();
    await page.getByRole('button', { name: 'Compare 2 selected records', exact: true }).click();
    const comparison = page.getByRole('dialog');
    await expect(comparison).toBeVisible();
    await expect(page).toHaveURL(/\/shortlist$/);
    await comparison.getByRole('button', { name: 'Remove 100 Bedok North Road from comparison' }).click();
    await page.keyboard.press('Escape');
    await expect(rows.first().getByRole('checkbox')).not.toBeChecked();
    const header = await page.locator('.saved-heading').boundingBox();
    const details = rows.first().getByRole('button', { name: 'Details', exact: true });
    await details.click();
    const panel = page.getByRole('region', { name: '100 Bedok North Road', exact: true });
    await expect(panel).toBeVisible();
    expect(await page.locator('.saved-heading').boundingBox()).toEqual(header);
    await panel.getByRole('button', { name: 'Viewing plan', exact: true }).click();
    await expect(panel.getByLabel(/New checklist item/)).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(details).toBeFocused();
    await rows.first().getByRole('button', { name: 'Remove 100 Bedok North Road from Saved' }).click();
    await expect(rows).toHaveCount(2);
    await page.getByRole('button', { name: 'Undo', exact: true }).click();
    await expect(rows).toHaveCount(3);
    await page.reload();
    const restored = page.locator('[data-saved-home="saved-0"]');
    await expect(restored.getByRole('textbox')).toHaveValue('Check afternoon noise');
    await expect(restored.getByRole('combobox')).toHaveValue('visit');
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
    expect(await page.evaluate(() => document.documentElement.scrollHeight <= innerHeight + 1)).toBe(true);
  });
}
