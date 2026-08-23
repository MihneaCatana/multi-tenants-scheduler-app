import '@testing-library/jest-dom/vitest';

/**
 * jsdom does not implement window.matchMedia. Mock it so components that
 * use media queries (e.g. SidebarContext) don't crash in tests.
 */
Object.defineProperty(window, 'matchMedia', {
  writable: true,
  value: (query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  }),
});
