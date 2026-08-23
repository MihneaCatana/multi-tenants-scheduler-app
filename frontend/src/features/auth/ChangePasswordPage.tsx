import { useState } from 'react'
import { api, ApiError } from '../../lib/api'
import { useAuth } from '../../lib/auth'
import { Button } from 'primereact/button'
import { Password } from 'primereact/password'
import { Message } from 'primereact/message'

export function ChangePasswordPage() {
  const { user, logout } = useAuth()
  const [done, setDone] = useState(false)
  const [currentPassword, setCurrentPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [submitting, setSubmitting] = useState(false)

  const validate = (): boolean => {
    const e: Record<string, string> = {}
    if (!currentPassword.trim()) e.currentPassword = 'Required'
    if (newPassword.length < 8) e.newPassword = 'Min 8 chars'
    if (confirm.length < 8) e.confirm = 'Min 8 chars'
    if (newPassword !== confirm) e.confirm = 'Passwords do not match'
    setErrors(e)
    return Object.keys(e).length === 0
  }

  const handleSubmit = async () => {
    if (!validate()) return
    setSubmitting(true)
    try {
      await api.changePassword({ currentPassword, newPassword })
      setDone(true)
      setTimeout(() => void logout(), 1500)
    } catch (err) {
      setErrors({ currentPassword: err instanceof ApiError ? err.message : 'Could not change password.' })
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div style={{ display: 'flex', minHeight: '100vh', alignItems: 'center', justifyContent: 'center', padding: '1rem', backgroundColor: 'var(--surface-ground)' }}>
      <div style={{ width: '100%', maxWidth: '24rem' }}>
        <div style={{ borderRadius: 'var(--content-border-radius)', border: '1px solid var(--surface-border)', backgroundColor: 'var(--surface-card)', padding: '1.75rem 1.5rem' }}>
          <h1 style={{ fontSize: '1rem', fontWeight: 600, color: 'var(--text-color)', margin: '0 0 0.25rem' }}>
            Change your password
          </h1>
          <p style={{ fontSize: '0.875rem', color: 'var(--text-color-secondary)', margin: '0 0 1.25rem' }}>
            {user?.email ? `${user.email} — ` : ''}Your password was reset by an administrator. Set a new one to continue.
          </p>

          {done ? (
            <Message severity="success" text="Password changed. Signing you out…" />
          ) : (
            <form onSubmit={(e) => { e.preventDefault(); void handleSubmit() }}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                <Field label="Current password" error={errors.currentPassword}>
                  <Password inputStyle={{ width: '100%' }} feedback={false} toggleMask autoComplete="current-password" value={currentPassword} onChange={(e) => setCurrentPassword(e.target.value)} />
                </Field>
                <Field label="New password" error={errors.newPassword}>
                  <Password inputStyle={{ width: '100%' }} toggleMask autoComplete="new-password" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} />
                </Field>
                <Field label="Confirm new password" error={errors.confirm}>
                  <Password inputStyle={{ width: '100%' }} feedback={false} toggleMask autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} />
                </Field>
                <Button
                  type="submit"
                  label={submitting ? 'Changing…' : 'Change password'}
                  style={{ width: '100%' }}
                  disabled={submitting}
                />
              </div>
            </form>
          )}
        </div>
      </div>
    </div>
  )
}

function Field({ label, error, children }: { label: string; error?: string; children: React.ReactNode }) {
  return (
    <div>
      <label style={{ display: 'block', marginBottom: '0.25rem', fontSize: '0.875rem', fontWeight: 500, color: 'var(--text-color)' }}>{label}</label>
      {children}
      {error && <small className="field-error">{error}</small>}
    </div>
  )
}
