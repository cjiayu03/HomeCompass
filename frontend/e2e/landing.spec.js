import { test, expect } from '@playwright/test';

for (const viewport of [{ width: 1440, height: 1000 }, { width: 390, height: 844 }]) {
  test(`landing search and product tour at ${viewport.width}px`, async ({ page }) => {
    test.setTimeout(45000);
    await page.setViewportSize(viewport);
    await page.goto('/');
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Find an HDB.Know the neighbourhood.');
    await expect(page.getByText('Past transactions, not live listings.', { exact: false })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await expect(page.getByRole('button', { name: 'Explore HDBs', exact: true })).toBeInViewport();
    const firstTab = page.getByRole('tab', { name: /Get to know the neighbourhood/ });
    await firstTab.focus();
    await page.keyboard.press('ArrowDown');
    await expect(page.getByRole('tab', { name: /Look beyond the price/ })).toHaveAttribute('aria-selected', 'true');
    await expect(page.getByRole('tabpanel')).toHaveAttribute('id', 'tour-panel-details');
    await page.keyboard.press('End');
    await expect(page.getByRole('tabpanel')).toHaveAttribute('id', 'tour-panel-compare');
    await expect(page.getByRole('tabpanel').getByRole('img')).toHaveAttribute('src', '/images/explore-compare.webp');
    const darkToggle = page.getByRole('button', { name: 'Use dark theme', exact: true });
    await darkToggle.click();
    await expect(page.locator('html')).toHaveClass(/dark/);
    await page.getByRole('button', { name: 'Use light theme', exact: true }).click();
    await expect(page.locator('html')).not.toHaveClass(/dark/);
    await page.getByRole('combobox', { name: 'Town', exact: true }).selectOption('Bishan');
    await page.getByRole('combobox', { name: 'Maximum resale price' }).selectOption('700000');
    await page.getByRole('button', { name: 'Explore HDBs', exact: true }).click();
    await expect(page).toHaveURL(/\/explore\?search=1&town=Bishan&budget=700000/);
    await expect(page.getByRole('textbox', { name: 'Search a town, street or amenity' })).toBeVisible();
    await expect(page.locator('.explore-applied')).toContainText('Bishan', { timeout: 20000 });
  });
}
