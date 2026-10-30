import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { Dock } from '../components/ui/dock';
import AccountPage from '../app/(workspace)/account/page';

const { auth, workspace, router } = vi.hoisted(() => ({ auth: vi.fn(), workspace: vi.fn(), router: { push: vi.fn(), replace: vi.fn() } }));
vi.mock('../components/auth-provider', () => ({ useAuth: auth }));
vi.mock('../components/workspace-provider', () => ({ useWorkspace: workspace }));
vi.mock('../components/theme-provider', () => ({ useAppTheme: () => ({ theme: 'light', setTheme: vi.fn() }) }));
vi.mock('../components/place-manager', () => ({ PlaceManager: () => <button>Save personal place</button> }));
vi.mock('../components/ui/number-ticker', () => ({ NumberTicker: ({ value }) => <span>{value}</span> }));
vi.mock('next/navigation', () => ({ usePathname: () => '/account', useRouter: () => router }));

function setup(overrides = {}) {
  const state = { user: { id: 'a', email: 'a@example.com' }, transitioning: false, sessionVerified: true, signOut: vi.fn(async () => {}), refreshSession: vi.fn(async () => {}), ...overrides };
  auth.mockReturnValue(state);
  workspace.mockReturnValue({ shortlistIds: [], compareIds: [], flash: vi.fn(), syncState: 'error', pendingLocalPlaceCount: 0, syncGuestData: vi.fn(), clearLocalData: vi.fn() });
  return state;
}

afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

it('blocks dock logout throughout a remote transition and enables retry afterward', async () => {
  const state = setup({ transitioning: true });
  const view = render(<Dock />);
  const signOut = screen.getByRole('button', { name: 'Sign out' });
  expect(signOut).toBeDisabled();
  fireEvent.click(signOut);
  expect(state.signOut).not.toHaveBeenCalled();
  auth.mockReturnValue({ ...state, transitioning: false });
  view.rerender(<Dock />);
  expect(screen.getByRole('button', { name: 'Sign out' })).toBeEnabled();
  fireEvent.click(screen.getByRole('button', { name: 'Sign out' }));
  await waitFor(() => expect(state.signOut).toHaveBeenCalledOnce());
});

it('keeps known-account logout paused until a failed ownership check is retried', () => {
  const state = setup({ sessionVerified: false });
  render(<Dock />);
  expect(screen.getByRole('button', { name: 'Sign out' })).toBeDisabled();
  fireEvent.click(screen.getByRole('button', { name: 'Sign out' }));
  expect(state.signOut).not.toHaveBeenCalled();
});

it('pauses account changes while ownership is unverified and offers a session retry', async () => {
  const state = setup({ sessionVerified: false });
  const fetchMock = vi.fn();
  vi.stubGlobal('fetch', fetchMock);
  render(<AccountPage />);
  expect(screen.getByText('Session not verified')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Delete account' })).toBeDisabled();
  expect(screen.getByRole('button', { name: 'Update password' })).toBeDisabled();
  expect(screen.getByRole('button', { name: 'Save personal place' })).toBeDisabled();
  expect(screen.getByRole('button', { name: 'Retry account sync' })).toBeDisabled();
  fireEvent.submit(screen.getByRole('button', { name: 'Update password' }).closest('form'));
  expect(fetchMock).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'Retry session check' }));
  await waitFor(() => expect(state.refreshSession).toHaveBeenCalledOnce());
});

it('closes the previous account deletion confirmation when the owner changes', async () => {
  const state = setup();
  const view = render(<AccountPage />);
  fireEvent.click(screen.getByRole('button', { name: 'Delete account' }));
  expect(within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Delete account' })).toBeEnabled();
  auth.mockReturnValue({ ...state, user: { id: 'b', email: 'b@example.com' } });
  view.rerender(<AccountPage />);
  await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument());
  expect(screen.getByText('b@example.com')).toBeInTheDocument();
});
