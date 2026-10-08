'use client';

import { ThemeProvider } from '@/components/theme-provider';
import { WorkspaceProvider } from '@/components/workspace-provider';
import { AuthProvider } from '@/components/auth-provider';

export function Providers({ children }) {
  return (
    <ThemeProvider>
      <AuthProvider>
        <WorkspaceProvider>{children}</WorkspaceProvider>
      </AuthProvider>
    </ThemeProvider>
  );
}
