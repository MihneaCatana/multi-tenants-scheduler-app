import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../../lib/auth'
import { ApiError } from '../../lib/api'
import { tenantContext, baseDomain } from '../../lib/tenant'
import { Spinner } from '../../components/Spinner'
import { TenantBadge } from '../../components/TenantBadge'
import { Button } from 'primereact/button'
import { InputText } from 'primereact/inputtext'
import { Password } from 'primereact/password'
import { Message } from 'primereact/message'

export function LoginPage() {
  const { login } = useAuth()
  const navigate = useNavigate()
  const ctx = tenantContext()
  const [serverError, setServerError] = useState<string | null>(null)
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [isSubmitting, setIsSubmitting] = useState(false)

  const validate = (): boolean => {
    const e: Record<string, string> = {}
    if (!email.trim()) e.email = 'Required'
    else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) e.email = 'Enter a valid email'
    if (!password.trim()) e.password = 'Enter your password'
    setErrors(e)
    return Object.keys(e).length === 0
  }

  const onSubmit = async () => {
    if (!validate()) return
    setServerError(null)
    setIsSubmitting(true)
    try {
      const user = await login(email, password)
      navigate(user.role === 'platform_admin' ? '/platform' : '/workspace', {
        replace: true,
      })
    } catch (err) {
      setServerError(err instanceof ApiError ? err.message : 'Could not reach the server. Is the backend running?')
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <div style={{ display: 'flex', minHeight: '100vh', alignItems: 'center', justifyContent: 'center', padding: '1rem', backgroundColor: 'var(--surface-ground)' }}>
      <div style={{ width: '100%', maxWidth: '24rem' }}>
        {/* Product header */}
        <div style={{ textAlign: 'center', marginBottom: '2rem' }}>
          <div style={{ fontSize: '1.875rem', fontWeight: 700, letterSpacing: '-0.025em', color: 'var(--text-color)', marginBottom: '0.25rem' }}>
            Simi Console
          </div>
          <p style={{ fontSize: '0.875rem', color: 'var(--text-color-secondary)' }}>
            Sign in to continue
          </p>
          <div style={{ marginTop: '0.75rem', display: 'flex', justifyContent: 'center' }}>
            <TenantBadge />
          </div>
        </div>

        {/* Login card */}
        <div style={{ borderRadius: 'var(--content-border-radius)', border: '1px solid var(--surface-border)', backgroundColor: 'var(--surface-card)', padding: '1.75rem 1.5rem' }}>
          <form onSubmit={(e) => { e.preventDefault(); void onSubmit() }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
              {/* Email field */}
              <div>
                <label htmlFor="email" style={{ display: 'block', marginBottom: '0.25rem', fontSize: '0.875rem', fontWeight: 500, color: 'var(--text-color)' }}>Email address</label>
                <InputText
                  id="email"
                  type="email"
                  style={{ width: '100%' }}
                  autoComplete="email"
                  placeholder={ctx.kind === 'platform' ? `admin@${baseDomain()}` : 'owner@acme.com'}
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                />
                {errors.email && <small className="field-error">{errors.email}</small>}
              </div>

              {/* Password field */}
              <div>
                <label htmlFor="password" style={{ display: 'block', marginBottom: '0.25rem', fontSize: '0.875rem', fontWeight: 500, color: 'var(--text-color)' }}>Password</label>
                <Password
                  id="password"
                  inputStyle={{ width: '100%' }}
                  feedback={false}
                  toggleMask
                  autoComplete="current-password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                />
                {errors.password && <small className="field-error">{errors.password}</small>}
              </div>

              {/* Server error */}
              {serverError && (
                <Message severity="error" text={serverError} />
              )}

              {/* Submit */}
              <Button
                type="submit"
                label={isSubmitting ? undefined : 'Sign in'}
                style={{ width: '100%' }}
                disabled={isSubmitting}
              >
                {isSubmitting && <Spinner size="1rem" />}
                {isSubmitting && <span style={{ marginLeft: '0.5rem' }}>Signing in…</span>}
              </Button>
            </div>
          </form>
        </div>

        {/* Context hint */}
        <p style={{ marginTop: '1.25rem', textAlign: 'center', fontSize: '0.75rem', color: 'var(--text-color-secondary)' }}>
          {ctx.kind === 'platform' ? (
            <>
              Platform admin host. For a tenant, open{' '}
              <code style={{ fontFamily: 'monospace', color: 'var(--text-color-secondary)' }}>
                tenant.{'<base-domain>'}
              </code>
              .
            </>
          ) : (
            <>
              Logging into tenant{' '}
              <code style={{ fontFamily: 'monospace', color: 'var(--text-color-secondary)' }}>
                {ctx.subdomain}
              </code>
              . The user must belong to this tenant.
            </>
          )}
        </p>
      </div>
    </div>
  )
}
