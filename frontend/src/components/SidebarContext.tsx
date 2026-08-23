import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';

const STORAGE_KEY = 'simi-sidebar-collapsed';

interface SidebarState {
  collapsed: boolean;
  mobileOpen: boolean;
  toggleCollapse: () => void;
  toggleMobile: () => void;
  closeMobile: () => void;
}

const SidebarCtx = createContext<SidebarState>({
  collapsed: false,
  mobileOpen: false,
  toggleCollapse: () => {},
  toggleMobile: () => {},
  closeMobile: () => {},
});

export function SidebarProvider({ children }: { children: ReactNode }) {
  const [collapsed, setCollapsed] = useState(() => {
    try {
      return localStorage.getItem(STORAGE_KEY) === 'true';
    } catch {
      return false;
    }
  });
  const [mobileOpen, setMobileOpen] = useState(false);

  // Sync collapsed state to localStorage
  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, String(collapsed));
    } catch {
      // Storage unavailable — ignore
    }
  }, [collapsed]);

  // Close mobile drawer when viewport crosses lg breakpoint
  useEffect(() => {
    const mql = window.matchMedia('(min-width: 1024px)');
    const handler = (e: MediaQueryListEvent) => {
      if (e.matches) setMobileOpen(false);
    };
    mql.addEventListener('change', handler);
    // If already above lg on mount, ensure mobile is closed
    if (mql.matches) setMobileOpen(false);
    return () => mql.removeEventListener('change', handler);
  }, []);

  const toggleCollapse = useCallback(() => setCollapsed((c) => !c), []);
  const toggleMobile = useCallback(() => setMobileOpen((o) => !o), []);
  const closeMobile = useCallback(() => setMobileOpen(false), []);

  return (
    <SidebarCtx.Provider value={{ collapsed, mobileOpen, toggleCollapse, toggleMobile, closeMobile }}>
      {children}
    </SidebarCtx.Provider>
  );
}

export function useSidebar() {
  return useContext(SidebarCtx);
}
