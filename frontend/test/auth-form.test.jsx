import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { AuthForm } from '../components/auth-form';
const {signUp}=vi.hoisted(()=>({signUp:vi.fn()}));
vi.mock('../components/auth-provider',()=>({useAuth:()=>({signUp,signIn:vi.fn()})}));
vi.mock('next/navigation',()=>({useRouter:()=>({replace:vi.fn()})}));
afterEach(()=>{cleanup();signUp.mockClear();});
it('shows passwords on request and focuses the first invalid field',()=>{render(<AuthForm mode="signup"/>);fireEvent.click(screen.getByRole('button',{name:'Create account'}));expect(screen.getByRole('textbox',{name:/Email/})).toHaveFocus();expect(screen.getByText('Enter a valid email address.')).toBeInTheDocument();fireEvent.click(screen.getByLabelText('Show password'));expect(document.querySelector('input[name="password"]')).toHaveAttribute('type','text');expect(document.querySelector('input[name="confirm"]')).toHaveAttribute('type','text');expect(signUp).not.toHaveBeenCalled();});
it('connects a mismatch error to confirmation and focuses it',()=>{render(<AuthForm mode="signup"/>);fireEvent.change(document.querySelector('[name="email"]'),{target:{value:'me@example.com'}});fireEvent.change(document.querySelector('[name="password"]'),{target:{value:'valid-password'}});fireEvent.change(document.querySelector('[name="confirm"]'),{target:{value:'other-password'}});fireEvent.click(screen.getByRole('button',{name:'Create account'}));expect(screen.getByText('Passwords do not match.')).toBeInTheDocument();expect(document.querySelector('[name="confirm"]')).toHaveFocus();expect(document.querySelector('[name="confirm"]')).toHaveAttribute('aria-invalid','true');expect(signUp).not.toHaveBeenCalled();});
