import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { AuthForm } from '../components/auth-form';

const auth = vi.hoisted(() => ({ signUp: vi.fn(), signIn: vi.fn(), transitioning: false }));
vi.mock('../components/auth-provider', () => ({ useAuth: () => auth }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ replace: vi.fn() }) }));

afterEach(() => {
  cleanup();
  auth.signUp.mockClear();
  auth.signIn.mockClear();
  auth.transitioning = false;
});

it('uses POST as the no-JavaScript fallback for credential submission', () => {
  render(<AuthForm mode="signup" />);
  expect(document.querySelector('form')).toHaveAttribute('method', 'post');
});

it('waits for an in-flight account change from another tab before submitting credentials', () => {
  auth.transitioning = true;
  render(<AuthForm mode="signup" />);
  fireEvent.change(document.querySelector('[name="email"]'), { target: { value: 'me@example.com' } });
  fireEvent.change(document.querySelector('[name="password"]'), { target: { value: 'valid-password' } });
  fireEvent.change(document.querySelector('[name="confirm"]'), { target: { value: 'valid-password' } });
  const submit = screen.getByRole('button', { name: 'Create account' });
  expect(submit).toBeDisabled();
  fireEvent.submit(document.querySelector('form'));
  expect(auth.signUp).not.toHaveBeenCalled();
});

it('shows passwords on request and focuses the first invalid field', () => {
  render(<AuthForm mode="signup" />);
  fireEvent.click(screen.getByRole('button', { name: 'Create account' }));
  expect(screen.getByRole('textbox', { name: /Email/ })).toHaveFocus();
  expect(screen.getByText('Enter a valid email address.')).toBeInTheDocument();
  fireEvent.click(screen.getByLabelText('Show password'));
  expect(document.querySelector('input[name="password"]')).toHaveAttribute('type', 'text');
  expect(document.querySelector('input[name="confirm"]')).toHaveAttribute('type', 'text');
  expect(auth.signUp).not.toHaveBeenCalled();
});

it('connects a mismatch error to confirmation and focuses it', () => {
  render(<AuthForm mode="signup" />);
  fireEvent.change(document.querySelector('[name="email"]'), { target: { value: 'me@example.com' } });
  fireEvent.change(document.querySelector('[name="password"]'), { target: { value: 'valid-password' } });
  fireEvent.change(document.querySelector('[name="confirm"]'), { target: { value: 'other-password' } });
  fireEvent.click(screen.getByRole('button', { name: 'Create account' }));
  expect(screen.getByText('Passwords do not match.')).toBeInTheDocument();
  expect(document.querySelector('[name="confirm"]')).toHaveFocus();
  expect(document.querySelector('[name="confirm"]')).toHaveAttribute('aria-invalid', 'true');
  expect(auth.signUp).not.toHaveBeenCalled();
});
