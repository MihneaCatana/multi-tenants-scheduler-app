import { NavLink } from 'react-router-dom'
import { useAuth } from '../lib/auth'
import { isApexHost } from '../lib/tenant'
import { FeatureFlag } from '../lib/flags'
import { useFlag } from '../features/flags/hooks'
import { useSidebar } from './SidebarContext'
import { useI18n } from '../lib/i18n'
import { Button } from 'primereact/button'

export function AppSidebar() {
  const { user } = useAuth()
  const apex = isApexHost()
  const { mobileOpen, closeMobile } = useSidebar()
  const { t } = useI18n()
  const appointmentsOn = useFlag(FeatureFlag.APPOINTMENTS)

  let items: { label: string; to: string; icon: string; end?: boolean }[] = []

  if (apex && user?.role === 'platform_admin') {
    items = [
      { label: 'Tenants', to: '/platform', icon: 'pi pi-th-large', end: true },
      { label: 'Feature flags', to: '/platform/features', icon: 'pi pi-flag' },
    ]
  } else if (!apex) {
    items = [
      { label: t('nav_staff'), to: '/workspace', icon: 'pi pi-users', end: true },
    ]
    if (user?.role === 'tenant_admin') {
      items.push({ label: t('nav_clients'), to: '/workspace/clients', icon: 'pi pi-building' })
    }
    if (appointmentsOn) {
      items.push({
        label: t('nav_calendar'),
        to: '/workspace/scheduling',
        icon: 'pi pi-calendar',
      })
    }
  }

  const navContent = (
    <div style={{ display: 'flex', height: '100%', flexDirection: 'column' }}>
      {/* Sidebar header */}
      <div style={{
        display: 'flex',
        height: '3rem',
        alignItems: 'center',
        justifyContent: 'space-between',
        borderBottom: '1px solid var(--surface-border)',
        padding: '0.5rem 1rem',
      }}>
        <span style={{
          userSelect: 'none',
          fontSize: '1rem',
          fontWeight: 600,
          letterSpacing: '-0.025em',
          color: 'var(--text-color)',
        }}>
          Simi
        </span>
        <Button
          icon="pi pi-times"
          text
          rounded
          size="small"
          onClick={closeMobile}
          aria-label="Close sidebar"
        />
      </div>

      {/* Navigation items */}
      <nav style={{ display: 'flex', flexDirection: 'column', gap: '2px', padding: '0.5rem' }}>
        {items.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            end={item.end}
            onClick={closeMobile}
            className={({ isActive }) =>
              `sidebar-link${isActive ? ' active' : ''}`
            }
          >
            <i className={item.icon} style={{ fontSize: '0.875rem', opacity: 0.6, flexShrink: 0 }} />
            <span>{item.label}</span>
          </NavLink>
        ))}
      </nav>

    </div>
  )

  return (
    <>
      {/* Desktop sidebar */}
      <aside style={{
        display: 'none',
        width: '14rem',
        flexShrink: 0,
        borderRight: '1px solid var(--surface-border)',
        backgroundColor: 'var(--surface-ground)',
        transition: 'width 0.2s ease-in-out',
        overflow: 'hidden',
      }} className="lg:flex lg:flex-col">
        {navContent}
      </aside>

      {/* Mobile drawer backdrop */}
      {mobileOpen && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            zIndex: 30,
            backgroundColor: 'rgba(0,0,0,0.3)',
            backdropFilter: 'blur(4px)',
          }}
          className="lg:hidden"
          onClick={closeMobile}
          aria-hidden="true"
        />
      )}

      {/* Mobile drawer */}
      <aside
        style={{
          position: 'fixed',
          inset: '0 0 0 0',
          left: 0,
          zIndex: 40,
          width: '16rem',
          borderRight: '1px solid var(--surface-border)',
          backgroundColor: 'var(--surface-ground)',
          transition: 'transform 0.2s ease-in-out',
          transform: mobileOpen ? 'translateX(0)' : 'translateX(-100%)',
        }}
        className="lg:hidden"
        aria-hidden={!mobileOpen}
      >
        {navContent}
      </aside>
    </>
  )
}
