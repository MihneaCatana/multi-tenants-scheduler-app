import { type ReactNode } from 'react'
import { useAuth } from '../lib/auth'
import { isApexHost } from '../lib/tenant'
import { TenantBadge } from './TenantBadge'
import { AppSidebar } from './AppSidebar'
import { useSidebar } from './SidebarContext'
import { Button } from 'primereact/button'
import { Link } from 'react-router-dom'

/**
 * Shared chrome for authenticated pages: sidebar + header + content area.
 */
export function AppLayout({
  children,
  title,
  actions,
}: {
  children: ReactNode
  title: string
  actions?: ReactNode
}) {
  const { user, logout } = useAuth()
  const { toggleMobile } = useSidebar()
  const apex = isApexHost()

  const userDisplay = user
    ? user.firstName
      ? `${user.firstName} ${user.lastName || ''}`.trim()
      : user.email
    : ''

  return (
    <div style={{ display: 'flex', minHeight: '100vh', backgroundColor: 'var(--surface-ground)' }}>
      <AppSidebar />

      <div style={{ display: 'flex', minWidth: 0, flex: 1, flexDirection: 'column' }}>
        {/* Top Bar */}
        <header style={{
          display: 'flex',
          height: '3rem',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '0 1rem',
          borderBottom: '1px solid var(--surface-border)',
          backgroundColor: 'var(--surface-ground)',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
            {/* Mobile hamburger */}
            <Button
              icon="pi pi-bars"
              text
              rounded
              size="small"
              className="lg:hidden"
              onClick={toggleMobile}
              aria-label="Open menu"
            />
            <h1 style={{
              fontSize: '1rem',
              fontWeight: 600,
              letterSpacing: '-0.025em',
              color: 'var(--text-color)',
              margin: 0,
            }}>
              {title}
            </h1>
            <TenantBadge />
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
            {user && (
              apex ? (
                <div className="hidden sm:flex" style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '0.5rem',
                  borderRadius: '9999px',
                  padding: '0.375rem 0.75rem',
                  fontSize: '0.875rem',
                  fontWeight: 500,
                  color: 'var(--text-color-secondary)',
                }}>
                  <i className="pi pi-user" style={{ fontSize: '0.875rem' }} />
                  <span>{userDisplay}</span>
                </div>
              ) : (
                <Link
                  to="/workspace/profile"
                  className="hidden sm:flex"
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '0.5rem',
                    borderRadius: '9999px',
                    padding: '0.375rem 0.75rem',
                    fontSize: '0.875rem',
                    fontWeight: 500,
                    color: 'var(--text-color-secondary)',
                    textDecoration: 'none',
                  }}
                >
                  <i className="pi pi-user" style={{ fontSize: '0.875rem' }} />
                  <span>{userDisplay}</span>
                </Link>
              )
            )}
            <Button
              label="Sign out"
              severity="secondary"
              outlined
              size="small"
              onClick={() => void logout()}
            />
          </div>
        </header>

        {/* Content Area */}
        <main style={{ flex: 1, padding: '1.5rem 1rem' }}>
          {actions && (
            <div style={{ marginBottom: '1.5rem', display: 'flex', justifyContent: 'flex-end' }}>{actions}</div>
          )}
          {children}
        </main>
      </div>
    </div>
  )
}
