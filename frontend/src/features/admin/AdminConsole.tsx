import { useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { DataTable } from 'primereact/datatable';
import { Column } from 'primereact/column';
import { Button } from 'primereact/button';
import { InputText } from 'primereact/inputtext';
import { Password } from 'primereact/password';
import { Badge } from 'primereact/badge';
import { Message } from 'primereact/message';
import { Menu } from 'primereact/menu';
import type { MenuItem } from 'primereact/menuitem';
import { api, ApiError } from '../../lib/api';
import { AppLayout } from '../../components/AppLayout';
import { Modal } from '../../components/Modal';
import { Spinner } from '../../components/Spinner';
import { EmptyState } from '../../components/EmptyState';
import { tenantUrl } from '../../lib/tenant';
import type { TenantSummary } from '../../lib/types';

/**
 * Platform admin console (apex host only).
 *
 * Three operations that drive the multi-tenant test loop:
 *   1. List tenants
 *   2. Provision a new tenant (full owner + dedicated DB) -> one-click open link
 *   3. Suspend / activate (which the backend pairs with session revocation)
 *
 * Provisioning is the only way to mint a tenant owner, so this screen is the
 * entry point for testing tenant-isolated data: provision Acme and Globex,
 * then open each workspace link to see they never share rows.
 */

interface ProvisionValues {
  name: string;
  subdomain: string;
  email: string;
  password: string;
  firstName: string;
  lastName: string;
}

const EMPTY_VALUES: ProvisionValues = {
  name: '',
  subdomain: '',
  email: '',
  password: '',
  firstName: '',
  lastName: '',
};

const SUBDOMAIN_RE = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Manual per-field validation mirroring the original zod schema. */
function validateProvision(v: ProvisionValues): Partial<Record<keyof ProvisionValues, string>> {
  const errors: Partial<Record<keyof ProvisionValues, string>> = {};

  if (!v.name) errors.name = 'Required';
  else if (v.name.length > 120) errors.name = 'Too long';

  if (v.subdomain.length < 2) errors.subdomain = 'Min 2 chars';
  else if (v.subdomain.length > 63) errors.subdomain = 'Max 63 chars';
  else if (!SUBDOMAIN_RE.test(v.subdomain)) errors.subdomain = 'Lowercase letters, digits, hyphens';

  if (!EMAIL_RE.test(v.email)) errors.email = 'Enter a valid email';

  if (v.password.length < 8) errors.password = 'Min 8 chars';
  else if (v.password.length > 128) errors.password = 'Max 128 chars';

  if (v.firstName.length > 80) errors.firstName = 'Max 80 chars';
  if (v.lastName.length > 80) errors.lastName = 'Max 80 chars';

  return errors;
}

export function AdminConsole() {
  const qc = useQueryClient();
  const [provisionOpen, setProvisionOpen] = useState(false);
  const [provisionSuccess, setProvisionSuccess] = useState<string | null>(null);
  const [values, setValues] = useState<ProvisionValues>(EMPTY_VALUES);
  const [errors, setErrors] = useState<Partial<Record<keyof ProvisionValues, string>>>({});
  const [touched, setTouched] = useState<Partial<Record<keyof ProvisionValues, boolean>>>({});

  const { data, isLoading, error } = useQuery({
    queryKey: ['tenants'],
    queryFn: () => api.listTenants({ limit: 100 }),
  });

  const provisionMutation = useMutation({
    mutationFn: (v: ProvisionValues) =>
      api.provisionTenant({
        name: v.name,
        subdomain: v.subdomain,
        email: v.email,
        password: v.password,
        firstName: v.firstName || undefined,
        lastName: v.lastName || undefined,
      }),
    onSuccess: (result) => {
      qc.invalidateQueries({ queryKey: ['tenants'] });
      setProvisionOpen(false);
      setProvisionSuccess(result.tenant.subdomain);
      setValues(EMPTY_VALUES);
      setErrors({});
      setTouched({});
    },
  });

  const statusMutation = useMutation({
    mutationFn: ({ id, status }: { id: string; status: 'active' | 'suspended' }) =>
      api.updateTenantStatus(id, status),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['tenants'] }),
  });

  function setField<K extends keyof ProvisionValues>(key: K, val: string) {
    const next = { ...values, [key]: val };
    setValues(next);
    // Live-validate only fields already touched so the form doesn't yell on
    // first keystroke.
    if (touched[key]) {
      setErrors(validateProvision(next));
    }
  }

  function blurField<K extends keyof ProvisionValues>(key: K) {
    setTouched({ ...touched, [key]: true });
    setErrors(validateProvision(values));
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const nextErrors = validateProvision(values);
    setErrors(nextErrors);
    setTouched({
      name: true,
      subdomain: true,
      email: true,
      password: true,
      firstName: true,
      lastName: true,
    });
    if (Object.keys(nextErrors).length > 0) return;
    provisionMutation.mutate(values);
  }

  function closeProvision() {
    setProvisionOpen(false);
    setValues(EMPTY_VALUES);
    setErrors({});
    setTouched({});
  }

  return (
    <AppLayout
      title="Tenants"
      actions={
        <Button
          type="button"
          label="+ Provision tenant"
          onClick={() => setProvisionOpen(true)}
        />
      }
    >
      {provisionSuccess && (
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: '0.75rem',
            marginBottom: '1rem',
          }}
        >
          <Message
            severity="success"
            text={
              <span>
                Provisioned{' '}
                <span style={{ fontFamily: 'monospace', fontWeight: 600 }}>
                  {provisionSuccess}
                </span>
                . The owner can now sign in at the tenant URL.
              </span>
            }
            style={{ flex: 1 }}
          />
          <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
            <Button
              type="button"
              severity="secondary"
              outlined
              size="small"
              label="Open workspace →"
              onClick={() => {
                window.open(tenantUrl(provisionSuccess), '_blank', 'noreferrer');
                setProvisionSuccess(null);
              }}
            />
            <Button
              type="button"
              text
              size="small"
              label="Dismiss"
              onClick={() => setProvisionSuccess(null)}
            />
          </div>
        </div>
      )}

      {isLoading ? (
        <div style={{ display: 'flex', justifyContent: 'center', padding: '4rem 0' }}>
          <Spinner />
        </div>
      ) : error ? (
        <ErrorBanner err={error} />
      ) : (
        <TenantTable
          tenants={data?.tenants ?? []}
          onStatus={(t, status) => statusMutation.mutate({ id: t.id, status })}
          busyId={statusMutation.isPending ? statusMutation.variables?.id : undefined}
        />
      )}

      {statusMutation.error ? (
        <p
          style={{
            marginTop: '0.75rem',
            fontSize: '0.75rem',
            color: 'var(--red-500, #ef4444)',
          }}
        >
          {statusMutation.error instanceof ApiError
            ? statusMutation.error.message
            : 'Status update failed'}
        </p>
      ) : null}

      <Modal
        open={provisionOpen}
        title="Provision a new tenant"
        onClose={closeProvision}
        footer={
          <>
            <Button
              type="button"
              severity="secondary"
              outlined
              size="small"
              label="Cancel"
              onClick={closeProvision}
            />
            <Button
              type="submit"
              form="provision-form"
              label={provisionMutation.isPending ? 'Provisioning…' : 'Provision tenant'}
              loading={provisionMutation.isPending}
              disabled={provisionMutation.isPending}
            />
          </>
        }
      >
        <form
          id="provision-form"
          onSubmit={handleSubmit}
          style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}
        >
          <p style={{ fontSize: '0.75rem', color: 'var(--text-color-secondary)' }}>
            This creates a dedicated database for the tenant and its owner. The owner can sign in
            at{' '}
            <span style={{ fontFamily: 'monospace', color: 'var(--text-color)' }}>
              subdomain.&lt;base-domain&gt;
            </span>
            .
          </p>
          <Field label="Tenant name" error={errors.name}>
            <InputText
              value={values.name}
              onChange={(e) => setField('name', e.target.value)}
              onBlur={() => blurField('name')}
              placeholder="Acme Inc"
              invalid={!!errors.name}
              style={{ width: '100%' }}
            />
          </Field>
          <Field label="Subdomain" error={errors.subdomain}>
            <InputText
              value={values.subdomain}
              onChange={(e) => setField('subdomain', e.target.value)}
              onBlur={() => blurField('subdomain')}
              placeholder="acme"
              invalid={!!errors.subdomain}
              style={{ width: '100%' }}
            />
          </Field>
          <Field label="Owner email" error={errors.email}>
            <InputText
              value={values.email}
              onChange={(e) => setField('email', e.target.value)}
              onBlur={() => blurField('email')}
              placeholder="owner@acme.com"
              invalid={!!errors.email}
              style={{ width: '100%' }}
            />
          </Field>
          <Field label="Owner password" error={errors.password}>
            <Password
              value={values.password}
              onChange={(e) => setField('password', e.target.value)}
              onBlur={() => blurField('password')}
              toggleMask
              feedback={false}
              autoComplete="new-password"
              invalid={!!errors.password}
              inputStyle={{ width: '100%' }}
              style={{ width: '100%' }}
            />
          </Field>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem' }}>
            <Field label="First name (optional)" error={errors.firstName}>
              <InputText
                value={values.firstName}
                onChange={(e) => setField('firstName', e.target.value)}
                onBlur={() => blurField('firstName')}
                invalid={!!errors.firstName}
                style={{ width: '100%' }}
              />
            </Field>
            <Field label="Last name (optional)" error={errors.lastName}>
              <InputText
                value={values.lastName}
                onChange={(e) => setField('lastName', e.target.value)}
                onBlur={() => blurField('lastName')}
                invalid={!!errors.lastName}
                style={{ width: '100%' }}
              />
            </Field>
          </div>
          {provisionMutation.error ? (
            <p style={{ fontSize: '0.75rem', color: 'var(--red-500, #ef4444)' }}>
              {provisionMutation.error instanceof ApiError
                ? provisionMutation.error.message
                : 'Provisioning failed'}
            </p>
          ) : null}
        </form>
      </Modal>
    </AppLayout>
  );
}

function TenantTable({
  tenants,
  onStatus,
  busyId,
}: {
  tenants: TenantSummary[];
  onStatus: (t: TenantSummary, status: 'active' | 'suspended') => void;
  busyId?: string;
}) {
  if (tenants.length === 0) {
    return (
      <EmptyState>No tenants yet. Provision one to begin testing multi-tenancy.</EmptyState>
    );
  }
  return (
    <DataTable
      value={tenants}
      dataKey="id"
      rowHover
      paginator
      rows={10}
      rowsPerPageOptions={[10, 25, 50, 100]}
      emptyMessage="No tenants found."
      tableStyle={{ minWidth: '40rem' }}
      style={{
        backgroundColor: 'var(--surface-card)',
        borderRadius: 'var(--content-border-radius)',
        border: '1px solid var(--surface-border)',
        overflow: 'hidden',
      }}
    >
      <Column
        field="name"
        header="Name"
        sortable
        body={(t: TenantSummary) => (
          <span style={{ fontWeight: 600, color: 'var(--text-color)' }}>{t.name}</span>
        )}
      />
      <Column
        field="subdomain"
        header="Subdomain"
        sortable
        body={(t: TenantSummary) => (
          <span style={{ fontFamily: 'monospace', color: 'var(--text-color-secondary)' }}>
            {t.subdomain}
          </span>
        )}
      />
      <Column
        field="status"
        header="Status"
        sortable
        body={(t: TenantSummary) => (
          <Badge
            value={t.status}
            severity={t.status === 'active' ? 'success' : 'warning'}
          />
        )}
      />
      <Column
        field="createdAt"
        header="Created"
        sortable
        body={(t: TenantSummary) => (
          <span style={{ color: 'var(--text-color-secondary)' }}>{formatDate(t.createdAt)}</span>
        )}
      />
      <Column
        header="Actions"
        body={(t: TenantSummary) => (
          <RowActions tenant={t} onStatus={onStatus} busyId={busyId} />
        )}
        bodyStyle={{ textAlign: 'right', width: '6rem' }}
      />
    </DataTable>
  );
}

/** Per-row actions menu: Open workspace, Suspend/Activate. */
function RowActions({
  tenant,
  onStatus,
  busyId,
}: {
  tenant: TenantSummary;
  onStatus: (t: TenantSummary, status: 'active' | 'suspended') => void;
  busyId?: string;
}) {
  const menuRef = useRef<Menu>(null);
  const busy = busyId === tenant.id;

  const items: MenuItem[] = [
    {
      label: 'Open',
      icon: 'pi pi-external-link',
      url: tenantUrl(tenant.subdomain),
      target: '_blank',
      disabled: tenant.status !== 'active',
    },
    { separator: true },
    tenant.status === 'active'
      ? {
          label: busy ? '…' : 'Suspend',
          icon: 'pi pi-ban',
          disabled: busy,
          command: () => onStatus(tenant, 'suspended'),
        }
      : {
          label: busy ? '…' : 'Activate',
          icon: 'pi pi-check-circle',
          disabled: busy,
          command: () => onStatus(tenant, 'active'),
        },
  ];

  return (
    <>
      <Menu model={items} popup ref={menuRef} />
      <Button
        type="button"
        icon="pi pi-ellipsis-v"
        text
        rounded
        size="small"
        aria-label={`Actions for ${tenant.name}`}
        onClick={(e) => menuRef.current?.toggle(e)}
      />
    </>
  );
}

function ErrorBanner({ err }: { err: unknown }) {
  const msg =
    err instanceof ApiError ? err.message : 'Could not load tenants. Is the backend running?';
  return <Message severity="error" text={msg} style={{ width: '100%' }} />;
}

function Field({
  label,
  error,
  children,
}: {
  label: string;
  error?: string;
  children: React.ReactNode;
}) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
      <label style={{ fontSize: '0.875rem', fontWeight: 500, color: 'var(--text-color)' }}>
        {label}
      </label>
      {children}
      {error && (
        <small className="field-error" style={{ color: 'var(--red-500, #ef4444)' }}>
          {error}
        </small>
      )}
    </div>
  );
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleString();
}
