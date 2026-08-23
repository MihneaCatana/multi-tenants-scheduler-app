import { useAuth } from '../../lib/auth';
import { AppLayout } from '../../components/AppLayout';
import { useI18n } from '../../lib/i18n';
import type { Locale } from '../../lib/i18n/translations';
import { Card } from 'primereact/card';

export function ProfilePage() {
  const { user } = useAuth();
  const { t, locale, setLocale } = useI18n();


  if (!user) return null;

  const labelStyle: React.CSSProperties = {
    display: 'block',
    marginBottom: '0.25rem',
    fontSize: '0.875rem',
    fontWeight: 500,
    color: 'var(--text-color)',
  };

  const valueStyle: React.CSSProperties = {
    fontSize: '0.875rem',
    color: 'var(--text-color)',
  };

  const sectionTitleStyle: React.CSSProperties = {
    fontSize: '1.125rem',
    fontWeight: 600,
    color: 'var(--text-color)',
    margin: '0 0 1.25rem',
  };

  return (
    <AppLayout title={t('profile_title')}>
      <div style={{ maxWidth: '42rem', display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>

        {/* ── Account Details ─────────────────────────────────────── */}
        <Card style={{ background: 'var(--surface-card)' }}>
          <h2 style={sectionTitleStyle}>
            {t('profile_accountDetails')}
          </h2>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
            <div>
              <label style={labelStyle}>{t('profile_email')}</label>
              <div style={{ ...valueStyle, fontWeight: 500 }}>
                {user.email}
              </div>
            </div>

            <div>
              <label style={labelStyle}>{t('profile_role')}</label>
              <div style={{ ...valueStyle, textTransform: 'capitalize' }}>
                {user.role.replace(/_/g, ' ')}
              </div>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
              <div>
                <label style={labelStyle}>{t('profile_firstName')}</label>
                <div style={valueStyle}>
                  {user.firstName || '—'}
                </div>
              </div>

              <div>
                <label style={labelStyle}>{t('profile_lastName')}</label>
                <div style={valueStyle}>
                  {user.lastName || '—'}
                </div>
              </div>
            </div>
          </div>
        </Card>

        {/* ── Preferences ─────────────────────────────────────────── */}
        <Card style={{ background: 'var(--surface-card)' }}>
          <h2 style={sectionTitleStyle}>
            {t('profile_preferences')}
          </h2>

          <div style={{ maxWidth: '20rem' }}>
            <Field label={t('profile_language')}>
              <select
                id="language-select"
                style={{
                  width: '100%',
                  height: '2.25rem',
                  padding: '0 0.5rem',
                  fontSize: '0.875rem',
                  color: 'var(--text-color)',
                  background: 'var(--surface-card)',
                  border: '1px solid var(--surface-border)',
                  borderRadius: 'var(--content-border-radius)',
                  cursor: 'pointer',
                }}
                value={locale}
                onChange={(e) => setLocale(e.target.value as Locale)}
              >
                <option value="en">English</option>
                <option value="ro">Română</option>
              </select>
            </Field>
            <p style={{ marginTop: '0.5rem', fontSize: '0.75rem', color: 'var(--text-color-secondary)' }}>
              {t('profile_languageHint')}
            </p>
          </div>
        </Card>

      </div>
    </AppLayout>
  );
}

function Field({ label, error, children }: { label: string; error?: string; children: React.ReactNode }) {
  return (
    <div>
      <label style={{ display: 'block', marginBottom: '0.25rem', fontSize: '0.875rem', fontWeight: 500, color: 'var(--text-color)' }}>{label}</label>
      {children}
      {error && <small className="field-error">{error}</small>}
    </div>
  );
}
