import { test, expect } from '@playwright/test';

for (const width of [1440, 390]) {
  test(`merged onboarding preserves preferences and current workspace at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 1000 });
    await page.emulateMedia({ reducedMotion: 'reduce' });
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    const towns = ['ANG MO KIO', 'BEDOK', 'BISHAN', 'BUKIT BATOK', 'JURONG EAST', 'TENGAH'];
    const home = { id: 'integration-1', address: '100 Bedok North Road', town: 'BEDOK', type: '4 ROOM', price: 500000, lat: 1.32, lng: 103.92, sourceSemantics: 'historical_transaction', observedOn: '2026-09-01', score: 72, risks: [], highlights: [] };
    let savedProfile;
    const profile = { adults: 2, children: 0, olderAdults: 0, budgetCents: null, priorityWeights: { school: 1, childcare: 1, care: 1, affordability: 1 }, preferredTowns: [], onboardingCompleted: false };
    await page.route('**/api/v1/**', route => {
      const path = new URL(route.request().url()).pathname;
      if (path === '/api/v1/profile') {
        const body = route.request().method() === 'PUT' ? route.request().postDataJSON() : null;
        if (body?.onboarding_completed) savedProfile = body;
        return route.fulfill({ json: { ...profile, onboardingCompleted: Boolean(savedProfile) } });
      }
      const payload = path === '/api/v1/auth/session' ? { user: { id: 'onboarding-preview', name: 'Preview', email: 'preview@example.test' } } : path === '/api/v1/search/options' ? { towns, flatTypes: ['3 ROOM', '4 ROOM', '5 ROOM'] } : path === '/api/v1/homes' || path === '/api/v1/search' ? { items: [home], total: 1, count: 1, dataMode: 'live', hasMore: false } : { items: [], features: [] };
      return route.fulfill({ json: payload });
    });
    await page.route('https://*.tile.openstreetmap.org/**', route => route.abort());
    await page.goto('/onboarding');
    await page.getByRole('button', { name: 'Increase Children (0–17)', exact: true }).click();
    await expect(page.getByLabel('Children (0–17) count')).toHaveText('1');
    await page.getByRole('button', { name: 'Continue', exact: true }).click();
    await page.getByLabel('Maximum recorded price', { exact: true }).fill('');
    await expect(page.getByText('No price ceiling.', { exact: false }).first()).toBeVisible();
    await page.getByRole('group', { name: 'Budget quick picks' }).getByRole('button', { name: '$600,000', exact: true }).click();
    await expect(page.getByLabel('Maximum recorded price', { exact: true })).toHaveValue('600000');
    await page.getByRole('button', { name: 'Continue', exact: true }).click();
    await page.getByRole('button', { name: /ANG MO KIO MRT lines/ }).click();
    await page.getByRole('button', { name: /BEDOK MRT lines/ }).click();
    await page.getByRole('button', { name: /BISHAN MRT lines/ }).click();
    await page.getByRole('button', { name: /BUKIT BATOK MRT lines/ }).click();
    await expect(page.getByRole('group', { name: 'Selected towns' }).getByRole('button')).toHaveCount(4);
    await page.getByRole('searchbox', { name: 'Search towns' }).fill('Tengah');
    await expect(page.getByRole('button', { name: /TENGAH MRT lines.*under construction/ })).toBeVisible();
    await page.getByRole('searchbox', { name: 'Search towns' }).fill('');
    await page.getByRole('button', { name: 'Continue', exact: true }).click();
    await page.getByRole('group', { name: 'Schools ranking weight' }).getByRole('button', { name: 'Not ranked', exact: true }).click();
    await page.getByRole('button', { name: 'Save and explore', exact: true }).click();
    await expect(page).toHaveURL(/\/explore$/);
    await expect(page.locator('article[data-home-id="integration-1"]')).toBeVisible();
    expect(savedProfile).toMatchObject({ budget_cents: 60000000, children: 1, priority_weights: { school: 0 }, preferred_towns: towns.slice(0, 4), onboarding_completed: true });
    await expect(page.getByRole('navigation', { name: 'Main navigation' }).getByRole('link', { name: 'Saved', exact: true })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
    expect(errors).toEqual([]);
  });
}
