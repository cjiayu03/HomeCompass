'use client';

import { ThemeProvider } from '@/components/theme-provider';
import { WorkspaceProvider } from '@/components/workspace-provider';
import { AuthProvider } from '@/components/auth-provider';
import { PlanningProvider } from '@/components/planning-provider';

export function Providers({ children }) {
  return (
    <ThemeProvider>
      <AuthProvider>
        <WorkspaceProvider><PlanningProvider>{children}</PlanningProvider></WorkspaceProvider>
      </AuthProvider>
    </ThemeProvider>
  );
}
