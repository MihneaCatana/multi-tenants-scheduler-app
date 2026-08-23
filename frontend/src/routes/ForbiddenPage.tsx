import { useAuth } from '../lib/auth'
import { apexUrl } from '../lib/tenant'
import { Button } from 'primereact/button'

export function ForbiddenPage() {
  const { user } = useAuth()
  const isPlatform = user?.role === 'platform_admin'

  return (
    <div style={{ display: 'flex', minHeight: '100vh', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: '0.75rem', padding: '1rem', textAlign: 'center', backgroundColor: 'var(--surface-ground)' }}>
      <p style={{ fontSize: '2.25rem', fontWeight: 600, color: 'var(--text-color)', margin: 0 }}>403</p>
      <p style={{ fontSize: '0.875rem', color: 'var(--text-color-secondary)', margin: 0 }}>
        {user ? (
          <>
            You're signed in as <code style={{ fontFamily: 'monospace' }}>{user.email}</code> ({user.role}), which doesn't have access here.
          </>
        ) : (
          'You do not have access to this page.'
        )}
      </p>
      <a
        href={apexUrl()}
        style={{ marginTop: '0.5rem', display: 'inline-flex', alignItems: 'center' }}
      >
        <Button
          label={isPlatform ? 'Go to platform console' : 'Switch host'}
          severity="secondary"
          outlined
          size="small"
        />
      </a>
    </div>
  )
}
