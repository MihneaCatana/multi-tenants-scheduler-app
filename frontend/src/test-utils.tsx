/**
 * Custom render() wrapper for component tests.
 *
 * Wraps the component in all required providers so tests don't repeat
 * boilerplate. Re-exports everything from @testing-library/react for
 * convenience.
 */
import { render, type RenderOptions } from '@testing-library/react';
import { type ReactElement, type ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { I18nProvider } from './lib/i18n/index.tsx';
import { SidebarProvider } from './components/SidebarContext.tsx';

interface WrapperOptions {
  /** Initial route entries for MemoryRouter. Default: ['/']. */
  initialEntries?: string[];
}

/**
 * Create a fresh QueryClient for each test to prevent cache leaks.
 */
function createTestQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0 },
      mutations: { retry: false },
    },
  });
}

/**
 * Render a component wrapped in all application providers.
 *
 * @example
 * ```tsx
 * import { screen } from '@/test-utils';
 * render(<MyComponent />);
 * expect(screen.getByText('Hello')).toBeInTheDocument();
 * ```
 */
export function renderWithProviders(
  ui: ReactElement,
  options?: RenderOptions & WrapperOptions,
) {
  const queryClient = createTestQueryClient();

  function AllProviders({ children }: { children: ReactNode }) {
    return (
      <QueryClientProvider client={queryClient}>
        <I18nProvider>
          <SidebarProvider>
            <MemoryRouter initialEntries={options?.initialEntries ?? ['/']}>
              {children}
            </MemoryRouter>
          </SidebarProvider>
        </I18nProvider>
      </QueryClientProvider>
    );
  }

  return {
    ...render(ui, { wrapper: AllProviders, ...options }),
    queryClient,
  };
}

// Re-export everything from @testing-library/react so consumers can do:
//   import { screen, renderWithProviders } from '@/test-utils';
export { render, screen, fireEvent, waitFor, act, within } from '@testing-library/react';
export { default as userEvent } from '@testing-library/user-event';
