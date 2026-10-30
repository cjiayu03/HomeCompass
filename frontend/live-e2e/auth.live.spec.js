import { mkdir, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { randomBytes } from 'node:crypto';
import { expect, request, test } from '@playwright/test';

const baseURL = process.env.HOMECOMPASS_E2E_BASE_URL || 'http://localhost:3000';
const apiURL = process.env.HOMECOMPASS_API_BASE_URL || 'http://127.0.0.1:8000';
const origin = new URL(baseURL).origin;
const cookieName = 'homecompass_session';
const reports = [];

function nonce() {
  return randomBytes(10).toString('hex');
}

function requestPath(response) {
  return new URL(response.url()).pathname;
}

function newAccount(slot) {
  return {
    email: `hc-live-${slot}-${nonce()}@example.test`,
    password: `Aa9!${randomBytes(18).toString('base64url')} `,
    id: null,
    cookie: null,
    api: null,
    created: false,
  };
}

async function apiClient() {
  return request.newContext({
    baseURL: apiURL,
    extraHTTPHeaders: { Origin: origin, Accept: 'application/json' },
  });
}

async function createAccount(account) {
  account.api = await apiClient();
  const response = await account.api.post('/api/v1/auth/register', {
    data: { email: account.email, password: account.password },
  });
  account.created = response.status() === 201;
  if (!account.created) throw new Error(`Disposable account setup failed with status ${response.status()}.`);
  const payload = await response.json();
  account.id = payload.user.id;
  account.cookie = response.headers()['set-cookie']?.match(/(?:^|[,;\s])homecompass_session=([^;,]*)/)?.[1] || null;
  if (!account.cookie) throw new Error('Disposable account setup did not return a session cookie.');
}

async function saveOneHomeForAccount(account) {
  const homesResponse = await account.api.get('/api/v1/homes?limit=1');
  const homes = await homesResponse.json();
  const homeId = homes.items?.[0]?.id;
  if (!homeId) throw new Error('No local home record was available for the disposable account.');
  const saved = await account.api.post('/api/v1/shortlists', { data: { home_id: homeId } });
  if (!saved.ok()) throw new Error(`Disposable shortlist setup failed with status ${saved.status()}.`);
  return homeId;
}

async function cleanupAccount(account, browserContext = null) {
  if (!account?.created) return { deleted: true, skipped: true };
  try {
    if (browserContext) {
      const session = await browserContext.request.get(`${baseURL}/api/v1/auth/session`, { timeout: 15_000 });
      const identity = session.ok() ? (await session.json()).user : null;
      if (identity?.id === account.id) {
        const response = await browserContext.request.delete(`${baseURL}/api/v1/account`, {
          headers: { Origin: origin },
          timeout: 15_000,
        });
        if (response.ok()) return { deleted: true };
      }
    }
    if (account.api) {
      const session = await account.api.get('/api/v1/auth/session', { timeout: 15_000 });
      const identity = session.ok() ? (await session.json()).user : null;
      if (identity?.id === account.id) {
        const response = await account.api.delete('/api/v1/account', { timeout: 15_000 });
        if (response.ok()) return { deleted: true };
      }
    }
    const cleanup = await apiClient();
    try {
      const login = await cleanup.post('/api/v1/auth/login', {
        data: { email: account.email, password: account.password },
        timeout: 15_000,
      });
      if (!login.ok()) return { deleted: false, loginStatus: login.status() };
      const identity = (await login.json()).user;
      if (identity?.id !== account.id) return { deleted: false, identityMatches: false };
      const response = await cleanup.delete('/api/v1/account', { timeout: 15_000 });
      return { deleted: response.ok(), status: response.status() };
    } finally {
      await cleanup.dispose();
    }
  } finally {
    await account.api?.dispose();
  }
}

async function waitForInitialSessionRead(page, path) {
  const session = page.waitForResponse(
    (response) => requestPath(response) === '/api/v1/auth/session',
    { timeout: 30_000 },
  );
  const navigation = await page.goto(`${baseURL}${path}`, { waitUntil: 'domcontentloaded' });
  const sessionResponse = await session;
  if (sessionResponse.status() !== 200) throw new Error(`Initial session read failed with status ${sessionResponse.status()}.`);
  return navigation?.status() ?? null;
}

test.afterAll(async () => {
  const path = process.env.HOMECOMPASS_E2E_REPORT_PATH || '/private/tmp/homecompass-auth-live-report.json';
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify({ baseURL: origin, cases: reports }, null, 2)}\n`, { mode: 0o600 });
});

test('credential forms keep secrets out of navigation URLs before JavaScript loads', async ({ browser }) => {
  const report = { case: 'no-js-credential-post', outcome: {} };
  reports.push(report);
  const secret = `N0JS!${randomBytes(14).toString('base64url')}`;
  const context = await browser.newContext({ javaScriptEnabled: false });
  const page = await context.newPage();
  try {
    await page.goto(`${baseURL}/signup`, { waitUntil: 'domcontentloaded' });
    await page.locator('[name="email"]').fill(`hc-live-nojs-${nonce()}@example.test`);
    await page.locator('[name="password"]').fill(secret);
    await page.locator('[name="confirm"]').fill(secret);
    const postRequest = page.waitForRequest((requestEvent) => (
      new URL(requestEvent.url()).pathname === '/signup' && requestEvent.method() === 'POST'
    ));
    await page.locator('[name="confirm"]').press('Enter');
    const requestEvent = await postRequest;
    const postBody = requestEvent.postData() || '';
    const submittedFields = new URLSearchParams(postBody);
    report.outcome = {
      methodPost: requestEvent.method() === 'POST',
      urlHasNoQuery: new URL(requestEvent.url()).search === '',
      passwordAbsentFromUrl: !requestEvent.url().includes(secret),
      credentialFieldsSentInBody: submittedFields.get('password') === secret && submittedFields.get('email')?.startsWith('hc-live-nojs-') === true,
    };
    expect(report.outcome).toEqual({
      methodPost: true,
      urlHasNoQuery: true,
      passwordAbsentFromUrl: true,
      credentialFieldsSentInBody: true,
    });
  } finally {
    await context.close();
  }
});

test('real signup, logout, failed login, login, and logout retry stay in sync', async ({ page, context }) => {
  const report = { case: 'browser-signup-login-logout', outcome: {} };
  reports.push(report);
  const account = newAccount('ui');
  try {
    report.outcome.signupPageStatus = await waitForInitialSessionRead(page, '/signup');
    await page.getByRole('button', { name: 'Create account' }).click();
    await expect(page.locator('[name="email"]')).toBeFocused();
    const email = `  ${account.email.toUpperCase()}  `;
    await page.locator('[name="email"]').fill(email);
    await page.locator('[name="password"]').fill(account.password);
    await page.locator('[name="confirm"]').fill(`${account.password}mismatch`);
    await page.getByRole('button', { name: 'Create account' }).click();
    await expect(page.getByText('Passwords do not match.')).toBeVisible();
    await page.locator('[name="confirm"]').fill(account.password);
    await page.getByLabel('Show password').check();
    report.outcome.passwordValueRetained = (await page.locator('[name="password"]').inputValue()) === account.password
      && await page.locator('[name="password"]').getAttribute('type') === 'text';
    await page.getByLabel('Show password').uncheck();
    const registration = page.waitForResponse((response) => requestPath(response) === '/api/v1/auth/register');
    await page.locator('[name="confirm"]').press('Enter');
    const registerResponse = await registration;
    report.outcome.signupStatus = registerResponse.status();
    account.created = registerResponse.status() === 201;
    if (account.created) {
      const payload = await registerResponse.json();
      account.id = payload.user.id;
    }
    expect(registerResponse.status()).toBe(201);
    await page.waitForURL('**/onboarding', { timeout: 30_000 });
    await page.getByRole('button', { name: 'Skip for now' }).waitFor({ timeout: 30_000 });
    await page.getByRole('button', { name: 'Skip for now' }).click();
    await page.waitForURL('**/explore', { timeout: 30_000 });
    await page.goto(`${baseURL}/account`, { waitUntil: 'domcontentloaded' });
    await expect(page.getByText(account.email, { exact: true })).toBeVisible();
    report.outcome.signedInAccountVisible = true;

    const secondTab = await context.newPage();
    await secondTab.goto(`${baseURL}/account`, { waitUntil: 'domcontentloaded' });
    await expect(secondTab.getByText(account.email, { exact: true })).toBeVisible();
    await secondTab.reload({ waitUntil: 'domcontentloaded' });
    await expect(secondTab.getByText(account.email, { exact: true })).toBeVisible();
    report.outcome.sessionSurvivesReloadAndNewTab = true;

    await secondTab.getByRole('button', { name: 'Sign out' }).click();
    await secondTab.waitForURL(`${baseURL}/`, { timeout: 30_000 });
    await expect(page.getByRole('button', { name: 'Sign in' })).toBeVisible();
    await page.goBack();
    await expect(page.getByRole('button', { name: 'Sign in' })).toBeVisible();
    await expect(page.getByText(account.email, { exact: true })).toHaveCount(0);
    await page.reload({ waitUntil: 'domcontentloaded' });
    await expect(page.getByRole('button', { name: 'Sign in' })).toBeVisible();
    await expect(page.getByText(account.email, { exact: true })).toHaveCount(0);
    report.outcome.backAndReloadAfterLogoutShowsGuest = true;
    report.outcome.logoutStatus = 200;

    const loginSession = secondTab.waitForResponse((response) => requestPath(response) === '/api/v1/auth/session', { timeout: 30_000 });
    await secondTab.goto(`${baseURL}/login`, { waitUntil: 'domcontentloaded' });
    expect((await loginSession).status()).toBe(200);
    await secondTab.locator('[name="email"]').fill(account.email);
    await secondTab.locator('[name="password"]').fill(`wrong-${account.password}`);
    const invalidLogin = secondTab.waitForResponse((response) => requestPath(response) === '/api/v1/auth/login');
    await secondTab.locator('[name="password"]').press('Enter');
    const invalidLoginResponse = await invalidLogin;
    report.outcome.wrongPasswordStatus = invalidLoginResponse.status();
    await expect(secondTab.getByText(/email or password is incorrect/i)).toBeVisible();
    await expect(secondTab.getByRole('button', { name: 'Sign out' })).toHaveCount(0);

    await secondTab.locator('[name="password"]').fill(account.password);
    const validLogin = secondTab.waitForResponse((response) => requestPath(response) === '/api/v1/auth/login');
    await secondTab.locator('[name="password"]').press('Enter');
    const validLoginResponse = await validLogin;
    report.outcome.correctPasswordStatus = validLoginResponse.status();
    await expect(validLoginResponse.status()).toBe(200);
    await secondTab.waitForURL('**/onboarding', { timeout: 30_000 });
    report.outcome.incompleteProfileReturnsToOnboarding = true;
    await secondTab.getByRole('button', { name: 'Skip for now' }).waitFor({ timeout: 30_000 });
    await secondTab.getByRole('button', { name: 'Skip for now' }).click();
    await secondTab.waitForURL('**/explore', { timeout: 30_000 });
    await secondTab.goto(`${baseURL}/account`, { waitUntil: 'domcontentloaded' });
    await expect(secondTab.getByText(account.email, { exact: true })).toBeVisible();
    account.api = await apiClient();
    const cleanupSession = await account.api.post('/api/v1/auth/login', {
      data: { email: account.email, password: account.password },
    });
    report.outcome.cleanupSessionReady = cleanupSession.status() === 200;
    expect(cleanupSession.status()).toBe(200);
    const completeProfile = await account.api.put('/api/v1/profile', {
      data: {
        adults: 2,
        children: 1,
        older_adults: 0,
        budget_cents: 55000000,
        locale: 'en-SG',
        priority_weights: { school: 3, childcare: 3, care: 1, affordability: 3 },
        preferred_towns: [],
        preferred_flat_type: null,
        max_school_distance_m: null,
        max_childcare_distance_m: null,
        max_care_distance_m: null,
        onboarding_completed: true,
      },
    });
    report.outcome.profileCompletionStatus = completeProfile.status();
    expect(completeProfile.status()).toBe(200);

    let failLogout = true;
    await secondTab.route('**/api/v1/auth/logout', async (route) => {
      if (!failLogout) return route.continue();
      failLogout = false;
      return route.fulfill({
        status: 503,
        contentType: 'application/json',
        body: JSON.stringify({ detail: { code: 'DATABASE_UNAVAILABLE', message: 'Persistent storage is unavailable. Please try again.' } }),
      });
    });
    await secondTab.getByRole('button', { name: 'Sign out' }).click();
    await expect(secondTab.getByRole('button', { name: 'Sign out' })).toBeEnabled();
    await expect(secondTab.getByText(/storage is unavailable/i)).toBeVisible();
    await expect(secondTab.getByText(account.email, { exact: true })).toBeVisible();
    report.outcome.failedLogoutRetainsAccount = true;
    await secondTab.unroute('**/api/v1/auth/logout');
    await secondTab.getByRole('button', { name: 'Sign out' }).click();
    await secondTab.waitForURL(`${baseURL}/`, { timeout: 30_000 });
    report.outcome.logoutRetryStatus = 200;
    const finalSession = secondTab.waitForResponse((response) => requestPath(response) === '/api/v1/auth/session', { timeout: 30_000 });
    await secondTab.goto(`${baseURL}/login`, { waitUntil: 'domcontentloaded' });
    expect((await finalSession).status()).toBe(200);
    await secondTab.locator('[name="email"]').fill(account.email);
    await secondTab.locator('[name="password"]').fill(account.password);
    const completeLogin = secondTab.waitForResponse((response) => requestPath(response) === '/api/v1/auth/login');
    await secondTab.locator('[name="password"]').press('Enter');
    const completeLoginResponse = await completeLogin;
    report.outcome.completeProfileLoginStatus = completeLoginResponse.status();
    expect(completeLoginResponse.status()).toBe(200);
    await secondTab.waitForURL('**/explore', { timeout: 30_000 });
    report.outcome.completeProfileReturnsToExplore = true;
  } finally {
    report.outcome.cleanup = await cleanupAccount(account);
    expect(report.outcome.cleanup.deleted).toBe(true);
  }
});

test('a delayed revoked-account response cannot erase the next tab login or carry account data', async ({ context, page }) => {
  const report = { case: 'two-tab-delayed-401-cookie-race', outcome: {} };
  reports.push(report);
  const accountA = newAccount('switch-a');
  const accountB = newAccount('switch-b');
  const accountAMarker = `HC_SWITCH_A_${nonce()}`;
  const missingPlaceId = 'b40c0e69-a760-4e4f-82b7-33fa6bc76d75';
  let accountAHomeId = null;
  let releaseFetch;
  let releaseResponse;
  let signalOldRequest;
  let signalStaleResponse;
  const fetchGate = new Promise((resolve) => { releaseFetch = resolve; });
  const responseGate = new Promise((resolve) => { releaseResponse = resolve; });
  const oldRequestSeen = new Promise((resolve) => { signalOldRequest = resolve; });
  const staleResponseReady = new Promise((resolve) => { signalStaleResponse = resolve; });
  let pageB;
  try {
    await createAccount(accountA);
    await createAccount(accountB);
    accountAHomeId = await saveOneHomeForAccount(accountA);
    // Keep a second A session in the API client so cleanup remains possible
    // after the browser tab explicitly signs out of A's first session.
    const cleanupSession = await accountA.api.post('/api/v1/auth/login', {
      data: { email: accountA.email, password: accountA.password },
    });
    report.outcome.cleanupSessionForA = cleanupSession.status() === 200;
    expect(cleanupSession.status()).toBe(200);
    report.outcome.setupStatuses = [201, 201];
    await context.addCookies([{ name: cookieName, value: accountA.cookie, url: baseURL, httpOnly: true, secure: false, sameSite: 'Lax' }]);
    await page.addInitScript(({ key, value }) => window.localStorage.setItem(key, JSON.stringify(value)), {
      key: `homecompass.account.${accountA.id}.workspace`,
      value: {
        brief: { adults: 5, budget: 700000 },
        shortlistIds: [accountAHomeId],
        compareIds: [],
        decisionHomes: [],
        pendingHistory: [{
          mode: 'structured',
          criteria: { query: accountAMarker, limit: 20, place_constraints: [{ place_id: missingPlaceId, max_distance_m: 2500 }] },
        }],
      },
    });
    await page.goto(`${baseURL}/account`, { waitUntil: 'domcontentloaded' });
    await expect(page.getByText(accountA.email, { exact: true })).toBeVisible();
    pageB = await context.newPage();
    await pageB.goto(`${baseURL}/account`, { waitUntil: 'domcontentloaded' });
    await expect(pageB.getByText(accountA.email, { exact: true })).toBeVisible();

    await page.route('**/api/v1/profile', async (route) => {
      const headers = await route.request().allHeaders();
      if (headers['x-auth-race-probe'] !== '1') return route.continue();
      report.outcome.heldRequestCarriedAccountACookie = Boolean(headers.cookie?.includes(accountA.cookie));
      signalOldRequest();
      await fetchGate;
      try {
        const response = await route.fetch();
        const setCookie = response.headers()['set-cookie'] || '';
        signalStaleResponse({
          status: response.status(),
          hasSetCookie: Boolean(setCookie),
          clearsSessionCookie: /homecompass_session=.*(?:max-age=0|expires=thu, 01 jan 1970)/i.test(setCookie),
        });
        await responseGate;
        await route.fulfill({ response });
      } catch (error) {
        signalStaleResponse({ status: null, fulfillError: error.name });
      }
    });
    const oldFetch = page.evaluate(async () => {
      const response = await fetch('/api/v1/profile', { headers: { 'x-auth-race-probe': '1' }, cache: 'no-store' });
      return response.status;
    });
    await oldRequestSeen;

    await pageB.getByRole('button', { name: 'Sign out' }).click();
    await pageB.waitForURL(`${baseURL}/`, { timeout: 30_000 });
    const loginSession = pageB.waitForResponse((response) => requestPath(response) === '/api/v1/auth/session', { timeout: 30_000 });
    await pageB.goto(`${baseURL}/login`, { waitUntil: 'domcontentloaded' });
    expect((await loginSession).status()).toBe(200);
    await pageB.locator('[name="email"]').fill(accountB.email);
    await pageB.locator('[name="password"]').fill(accountB.password);
    const login = pageB.waitForResponse((response) => requestPath(response) === '/api/v1/auth/login');
    await pageB.locator('[name="password"]').press('Enter');
    const loginResponse = await login;
    report.outcome.accountBLoginStatus = loginResponse.status();
    expect(loginResponse.status()).toBe(200);
    await pageB.goto(`${baseURL}/account`, { waitUntil: 'domcontentloaded' });
    await expect(pageB.getByText(accountB.email, { exact: true })).toBeVisible();
    await expect(page.getByText(accountB.email, { exact: true })).toBeVisible();
    await expect(page.getByText(/Your session expired/)).toHaveCount(0);
    await expect(pageB.getByText(/Your session expired/)).toHaveCount(0);
    report.outcome.noStaleExpiryWarningAfterSwitch = true;
    report.outcome.accountBReconciledInBothTabs = true;

    const before = (await context.cookies(baseURL)).find((cookie) => cookie.name === cookieName)?.value || '';
    report.outcome.newAccountCookieInstalled = Boolean(before && before !== accountA.cookie);
    releaseFetch();
    const staleResponse = await staleResponseReady;
    report.outcome.delayedResponse = staleResponse;
    releaseResponse();
    const oldResponseStatus = await oldFetch;
    report.outcome.oldRequestStatus = oldResponseStatus;
    const after = (await context.cookies(baseURL)).find((cookie) => cookie.name === cookieName)?.value || '';
    report.outcome.accountBCookieSurvived = Boolean(before && after === before);
    report.outcome.sessionStillBelongsToB = await page.evaluate(async (expectedEmail) => {
      const response = await fetch('/api/v1/auth/session', { cache: 'no-store' });
      const payload = await response.json();
      return response.status === 200 && payload.user?.email === expectedEmail;
    }, accountB.email);
    const workspaceOwners = await page.evaluate(({ idA, idB }) => {
      const parse = (key) => JSON.parse(localStorage.getItem(key) || '{}');
      return {
        a: parse(`homecompass.account.${idA}.workspace`),
        b: parse(`homecompass.account.${idB}.workspace`),
      };
    }, { idA: accountA.id, idB: accountB.id });
    report.outcome.accountADataStayedScoped = workspaceOwners.a.shortlistIds?.includes(accountAHomeId) === true
      && workspaceOwners.a.pendingHistory?.some((entry) => entry.criteria?.query === accountAMarker) === true;
    report.outcome.accountBDataStayedIsolated = workspaceOwners.b.shortlistIds?.includes(accountAHomeId) !== true
      && workspaceOwners.b.pendingHistory?.some((entry) => entry.criteria?.query === accountAMarker) !== true
      && workspaceOwners.b.brief?.adults !== 5;
    expect(report.outcome).toMatchObject({
      heldRequestCarriedAccountACookie: true,
      delayedResponse: { status: 401, hasSetCookie: false, clearsSessionCookie: false },
      newAccountCookieInstalled: true,
      accountBCookieSurvived: true,
      sessionStillBelongsToB: true,
      noStaleExpiryWarningAfterSwitch: true,
      accountADataStayedScoped: true,
      accountBDataStayedIsolated: true,
    });
  } finally {
    releaseFetch();
    releaseResponse();
    report.outcome.cleanupA = await cleanupAccount(accountA);
    report.outcome.cleanupB = await cleanupAccount(accountB);
    expect(report.outcome.cleanupA.deleted).toBe(true);
    expect(report.outcome.cleanupB.deleted).toBe(true);
  }
});

test('a real expired sync preserves pending guest data and recovers after sign-in', async ({ context, page }) => {
  const report = { case: 'expired-session-warning-and-recovery', outcome: {} };
  reports.push(report);
  const account = newAccount('expiry');
  const history = [{ mode: 'structured', criteria: { query: `HC ${nonce()}`, limit: 20 } }];
  let guestHomeId = null;
  const guestSnapshot = {
    brief: { adults: 3 },
    shortlistHomeIds: [],
    compareHomeIds: [],
    history,
    places: [],
  };
  let releaseFetch;
  let releaseResponse;
  let signalSyncRequest;
  let signalUnauthorizedResponse;
  const syncGate = new Promise((resolve) => { releaseFetch = resolve; });
  const responseGate = new Promise((resolve) => { releaseResponse = resolve; });
  const syncSeen = new Promise((resolve) => { signalSyncRequest = resolve; });
  const unauthorizedReady = new Promise((resolve) => { signalUnauthorizedResponse = resolve; });
  let syncResponseCount = 0;
  const syncResponses = [];
  const authResponses = [];
  try {
    test.setTimeout(180_000);
    console.log('Auth live suite: waiting 61 seconds for the local API auth rate window to reset before expiry and recovery checks.');
    await new Promise((resolve) => setTimeout(resolve, 61_000));
    await createAccount(account);
    const homesResponse = await account.api.get('/api/v1/homes?limit=1');
    const homesPayload = await homesResponse.json();
    guestHomeId = homesPayload.items?.[0]?.id || null;
    if (!guestHomeId) throw new Error('No local home record was available for the disposable guest sync.');
    guestSnapshot.shortlistHomeIds = [guestHomeId];
    await context.addCookies([{ name: cookieName, value: account.cookie, url: baseURL, httpOnly: true, secure: false, sameSite: 'Lax' }]);
    await page.addInitScript((snapshot) => window.localStorage.setItem('homecompass.guest-sync-pending', JSON.stringify(snapshot)), guestSnapshot);
    page.on('response', (response) => {
      const path = requestPath(response);
      if (['/api/v1/auth/session', '/api/v1/auth/login', '/api/v1/profile', '/api/v1/sync/guest'].includes(path)) {
        authResponses.push({ path, status: response.status() });
      }
    });
    page.on('response', async (response) => {
      if (requestPath(response) !== '/api/v1/sync/guest') return;
      const event = { status: response.status() };
      if (response.status() === 200) {
        try {
          const body = await response.json();
          event.acceptedHistory = body.accepted?.history ?? null;
        } catch { event.acceptedHistory = null; }
      }
      syncResponses.push(event);
    });
    await page.route('**/api/v1/sync/guest', async (route) => {
      syncResponseCount += 1;
      if (syncResponseCount !== 1) return route.continue();
      const requestBody = route.request().postDataJSON();
      report.outcome.initialRequestHasPendingHistory = requestBody.history?.length === 1;
      report.outcome.initialRequestHasGuestBrief = requestBody.brief?.adults === 3;
      signalSyncRequest();
      await syncGate;
      try {
        const response = await route.fetch();
        const setCookie = response.headers()['set-cookie'] || '';
        signalUnauthorizedResponse({
          status: response.status(),
          hasSetCookie: Boolean(setCookie),
          clearsSessionCookie: /homecompass_session=.*(?:max-age=0|expires=thu, 01 jan 1970)/i.test(setCookie),
        });
        await responseGate;
        await route.fulfill({ response });
      } catch (error) {
        signalUnauthorizedResponse({ status: null, fulfillError: error.name });
      }
    });

    await page.goto(`${baseURL}/account`, { waitUntil: 'domcontentloaded' });
    await expect(page.getByText(account.email, { exact: true })).toBeVisible();
    await syncSeen;
    report.outcome.revocationStatus = (await account.api.post('/api/v1/auth/logout')).status();
    releaseFetch();
    const response = await unauthorizedReady;
    report.outcome.expiredSyncResponse = response;
    const expiredSync = page.waitForResponse((candidate) => requestPath(candidate) === '/api/v1/sync/guest' && candidate.status() === 401);
    releaseResponse();
    await expiredSync;
    await expect(page.getByText(/Your session expired\. Please sign in again\. Guest data is still saved in this browser; retry account sync after signing in\./)).toBeVisible({ timeout: 30_000 });
    await expect(page.getByText('Guest', { exact: true })).toBeVisible();
    report.outcome.expiredWarningShownWithGuestUi = true;

    const pending = await page.evaluate((accountId) => ({
      guest: JSON.parse(localStorage.getItem('homecompass.guest-sync-pending') || 'null'),
      account: JSON.parse(localStorage.getItem(`homecompass.account.${accountId}.workspace`) || '{}'),
    }), account.id);
    report.outcome.pendingHistoryPreservedOnAccount = JSON.stringify(pending.account.pendingHistory || []) === JSON.stringify(history);
    report.outcome.guestBriefPreserved = pending.guest?.brief?.adults === 3;
    report.outcome.guestShortlistPreserved = pending.guest?.shortlistHomeIds?.includes(guestHomeId) === true;
    expect(report.outcome.pendingHistoryPreservedOnAccount).toBe(true);
    expect(report.outcome.guestBriefPreserved).toBe(true);
    expect(report.outcome.guestShortlistPreserved).toBe(true);

    const reloginSession = page.waitForResponse((candidate) => requestPath(candidate) === '/api/v1/auth/session', { timeout: 30_000 });
    await page.goto(`${baseURL}/login`, { waitUntil: 'domcontentloaded' });
    expect((await reloginSession).status()).toBe(200);
    await page.locator('[name="email"]').fill(account.email);
    await page.locator('[name="password"]').fill(account.password);
    const login = page.waitForResponse((candidate) => requestPath(candidate) === '/api/v1/auth/login');
    const successfulSync = page.waitForResponse((candidate) => requestPath(candidate) === '/api/v1/sync/guest' && candidate.status() === 200, { timeout: 30_000 });
    await page.locator('[name="password"]').press('Enter');
    const loginResponse = await login;
    report.outcome.reloginStatus = loginResponse.status();
    expect(loginResponse.status()).toBe(200);
    const successfulSyncResponse = await successfulSync.catch(async (error) => {
      report.outcome.authResponseStatuses = authResponses;
      report.outcome.sessionAfterRelogin = await page.evaluate(async () => {
        const response = await fetch('/api/v1/auth/session', { cache: 'no-store' });
        const payload = await response.json();
        return { status: response.status, userPresent: Boolean(payload.user) };
      });
      throw error;
    });
    const successfulSyncBody = await successfulSyncResponse.json();
    report.outcome.recoveredSyncHistoryAccepted = successfulSyncBody.accepted?.history ?? null;
    report.outcome.recoveredShortlistAccepted = successfulSyncBody.accepted?.shortlistHomeIds ?? null;
    await page.waitForURL('**/onboarding', { timeout: 30_000 });
    await page.getByRole('button', { name: 'Skip for now' }).waitFor({ timeout: 30_000 });
    await page.getByRole('button', { name: 'Skip for now' }).click();
    await page.waitForURL('**/explore', { timeout: 30_000 });
    await page.goto(`${baseURL}/account`, { waitUntil: 'domcontentloaded' });
    await expect(page.getByText(account.email, { exact: true })).toBeVisible();
    await expect(page.getByText(/Your session expired/)).toHaveCount(0);
    report.outcome.sameAccountReloginClearedWarning = true;
    report.outcome.syncResponseStatuses = syncResponses.map((entry) => entry.status);
    report.outcome.syncResponseHistoryAccepted = syncResponses.map((entry) => entry.acceptedHistory);

    report.outcome.persistedHistory = await page.evaluate(async (expectedQuery) => {
      const response = await fetch('/api/v1/history', { cache: 'no-store' });
      const payload = await response.json();
      const items = payload.items || [];
      return {
        status: response.status,
        count: items.length,
        matchingPendingQueryCount: items.filter((entry) => JSON.stringify(entry.criteria).includes(expectedQuery)).length,
      };
    }, history[0].criteria.query);
    expect(report.outcome).toMatchObject({
      revocationStatus: 200,
      expiredSyncResponse: { status: 401, hasSetCookie: false, clearsSessionCookie: false },
      reloginStatus: 200,
      recoveredSyncHistoryAccepted: 1,
      recoveredShortlistAccepted: 1,
      persistedHistory: { status: 200, matchingPendingQueryCount: 1 },
      sameAccountReloginClearedWarning: true,
    });
  } finally {
    releaseFetch();
    releaseResponse();
    report.outcome.cleanup = await cleanupAccount(account, context);
    expect(report.outcome.cleanup.deleted).toBe(true);
  }
});

test('a failed cross-tab session check pauses account work until B is verified', async ({ context, page }) => {
  const report = { case: 'remote-session-check-failure-pauses-account-work', outcome: {} };
  reports.push(report);
  const accountA = newAccount('verify-a');
  const accountB = newAccount('verify-b');
  const accountAMarker = `HC_PRIVATE_A_${nonce()}`;
  const missingPlaceId = 'b40c0e69-a760-4e4f-82b7-33fa6bc76d75';
  let accountAHomeId = null;
  let failFirstBSessionRead = true;
  let sessionFailureApplied = false;
  let collectPrivateRequests = true;
  const privateRequestsUnderB = [];
  let pageB;
  try {
    await createAccount(accountA);
    await createAccount(accountB);
    accountAHomeId = await saveOneHomeForAccount(accountA);
    await context.addCookies([{ name: cookieName, value: accountA.cookie, url: baseURL, httpOnly: true, secure: false, sameSite: 'Lax' }]);
    await page.addInitScript(({ key, value }) => window.localStorage.setItem(key, JSON.stringify(value)), {
      key: `homecompass.account.${accountA.id}.workspace`,
      value: {
        brief: { adults: 5, budget: 700000 },
        shortlistIds: [accountAHomeId],
        compareIds: [],
        decisionHomes: [],
        pendingHistory: [{ mode: 'structured', criteria: { query: accountAMarker, limit: 20, place_constraints: [{ place_id: missingPlaceId, max_distance_m: 2500 }] } }],
      },
    });
    await page.goto(`${baseURL}/account`, { waitUntil: 'domcontentloaded' });
    await expect(page.getByText(accountA.email, { exact: true })).toBeVisible();
    await expect(page.getByText('Signed in', { exact: true })).toBeVisible();
    await page.route('**/api/v1/auth/session', async (route) => {
      const headers = await route.request().allHeaders();
      if (failFirstBSessionRead && headers.cookie && !headers.cookie.includes(accountA.cookie)) {
        failFirstBSessionRead = false;
        sessionFailureApplied = true;
        report.outcome.sessionCheckUsedChangedCookie = true;
        return route.fulfill({
          status: 503,
          contentType: 'application/json',
          body: JSON.stringify({ detail: { code: 'DATABASE_UNAVAILABLE', message: 'Persistent storage is unavailable. Please try again.' } }),
        });
      }
      return route.continue();
    });
    page.on('request', async (requestEvent) => {
      const path = requestPath(requestEvent);
      if (!['/api/v1/profile', '/api/v1/shortlists', '/api/v1/sync/guest', '/api/v1/places', '/api/v1/planning/workspace'].includes(path)) return;
      const headers = await requestEvent.allHeaders();
      if (!collectPrivateRequests) return;
      const cookie = headers.cookie || '';
      if (cookie.includes(`${cookieName}=`) && !cookie.includes(accountA.cookie)) {
        const body = requestEvent.postData() || '';
        privateRequestsUnderB.push({ path, containsAData: body.includes(accountAMarker) || body.includes(accountAHomeId) });
      }
    });

    pageB = await context.newPage();
    const initialRead = pageB.waitForResponse((response) => requestPath(response) === '/api/v1/auth/session', { timeout: 30_000 });
    await pageB.goto(`${baseURL}/login`, { waitUntil: 'domcontentloaded' });
    expect((await initialRead).status()).toBe(200);
    await pageB.locator('[name="email"]').fill(accountB.email);
    await pageB.locator('[name="password"]').fill(accountB.password);
    const login = pageB.waitForResponse((response) => requestPath(response) === '/api/v1/auth/login', { timeout: 30_000 });
    await pageB.locator('[name="password"]').press('Enter');
    const loginResponse = await login;
    report.outcome.accountBLoginStatus = loginResponse.status();
    expect(loginResponse.status()).toBe(200);
    const browserCookieB = (await context.cookies(baseURL)).find((cookie) => cookie.name === cookieName)?.value || '';
    report.outcome.accountBCookieInstalled = Boolean(browserCookieB && browserCookieB !== accountA.cookie);

    await expect(page.getByText('Session not verified', { exact: true })).toBeVisible({ timeout: 30_000 });
    await expect(page.getByText(/Account changes are paused until we can confirm who is signed in/i)).toBeVisible();
    await expect(page.getByRole('button', { name: 'Sign out' })).toBeDisabled();
    await expect(page.getByRole('button', { name: 'Retry session check' })).toBeEnabled();
    await page.waitForTimeout(300);
    report.outcome.sessionCheckReturned503ForB = sessionFailureApplied;
    report.outcome.noPrivateAccountRequestsUnderBWhileUnverified = privateRequestsUnderB.length === 0;

    await page.getByRole('button', { name: 'Retry session check' }).click();
    await expect(page.getByText(accountB.email, { exact: true })).toBeVisible({ timeout: 30_000 });
    await expect(page.getByText(accountA.email, { exact: true })).toHaveCount(0);
    await expect(page.getByText('Signed in', { exact: true })).toBeVisible();
    await expect(page.getByText('Session not verified', { exact: true })).toHaveCount(0);
    report.outcome.retryConfirmedB = true;
    report.outcome.noAccountAEmailRenderedUnderB = true;
    await page.waitForTimeout(500);
    report.outcome.noAccountADataSentUnderB = privateRequestsUnderB.every((item) => !item.containsAData);
    const workspaceOwners = await page.evaluate(({ idA, idB }) => {
      const parse = (key) => JSON.parse(localStorage.getItem(key) || '{}');
      return {
        a: parse(`homecompass.account.${idA}.workspace`),
        b: parse(`homecompass.account.${idB}.workspace`),
      };
    }, { idA: accountA.id, idB: accountB.id });
    report.outcome.accountAWorkspaceStayedScoped = workspaceOwners.a.shortlistIds?.includes(accountAHomeId) === true
      && workspaceOwners.a.pendingHistory?.some((entry) => entry.criteria?.query === accountAMarker) === true;
    report.outcome.accountBWorkspaceStayedIsolated = workspaceOwners.b.shortlistIds?.includes(accountAHomeId) !== true
      && workspaceOwners.b.pendingHistory?.some((entry) => entry.criteria?.query === accountAMarker) !== true;
    expect(report.outcome).toMatchObject({
      accountBLoginStatus: 200,
      accountBCookieInstalled: true,
      sessionCheckUsedChangedCookie: true,
      sessionCheckReturned503ForB: true,
      noPrivateAccountRequestsUnderBWhileUnverified: true,
      retryConfirmedB: true,
      noAccountAEmailRenderedUnderB: true,
      noAccountADataSentUnderB: true,
      accountAWorkspaceStayedScoped: true,
      accountBWorkspaceStayedIsolated: true,
    });
  } finally {
    collectPrivateRequests = false;
    report.outcome.cleanupA = await cleanupAccount(accountA);
    report.outcome.cleanupB = await cleanupAccount(accountB);
    expect(report.outcome.cleanupA.deleted).toBe(true);
    expect(report.outcome.cleanupB.deleted).toBe(true);
  }
});
