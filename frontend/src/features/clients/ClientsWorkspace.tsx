import { useState, useRef, type ReactNode } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { format } from 'date-fns';
import { DataTable } from 'primereact/datatable';
import { Column } from 'primereact/column';
import { Button } from 'primereact/button';
import { InputText } from 'primereact/inputtext';
import { InputTextarea } from 'primereact/inputtextarea';
import { Message } from 'primereact/message';
import { Menu } from 'primereact/menu';
import type { MenuItem } from 'primereact/menuitem';
import { api, ApiError } from '../../lib/api';
import { AppLayout } from '../../components/AppLayout';
import { Modal } from '../../components/Modal';
import { Spinner } from '../../components/Spinner';
import { EmptyState } from '../../components/EmptyState';
import { getSubdomain } from '../../lib/tenant';
import { useI18n } from '../../lib/i18n';
import type { Client } from '../../lib/types';
import { Link } from 'react-router-dom';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface FormValues {
  name: string;
  email: string;
  phone: string;
  notes: string;
}

interface FormErrors {
  name?: string;
  email?: string;
  phone?: string;
  notes?: string;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function clean(val: string | undefined): string | undefined {
  if (!val || val.trim() === '') return undefined;
  return val.trim();
}

function validateForm(values: FormValues): FormErrors {
  const errors: FormErrors = {};
  if (!values.name.trim()) errors.name = 'Name is required';
  else if (values.name.length > 160) errors.name = 'Name is too long';
  if (values.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(values.email))
    errors.email = 'Enter a valid email';
  if (values.email.length > 254) errors.email = 'Email is too long';
  if (values.phone.length > 40) errors.phone = 'Phone is too long';
  if (values.notes.length > 5000) errors.notes = 'Notes are too long';
  return errors;
}

// ---------------------------------------------------------------------------
// Field component
// ---------------------------------------------------------------------------

function Field({ label, error, children }: { label: string; error?: string; children: ReactNode }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
      <label style={{ fontSize: '0.875rem', fontWeight: 500, color: 'var(--text-color)' }}>{label}</label>
      {children}
      {error && <small style={{ color: 'var(--red-500)', fontSize: '0.75rem' }}>{error}</small>}
    </div>
  );
}

// ---------------------------------------------------------------------------
// ClientsWorkspace
// ---------------------------------------------------------------------------

export function ClientsWorkspace() {
  const { t } = useI18n();
  const subdomain = getSubdomain();
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<Client | null>(null);
  const [deleting, setDeleting] = useState<Client | null>(null);
  const menuRef = useRef<Menu>(null);
  const [menuItems, setMenuItems] = useState<MenuItem[]>([]);
  const queryClient = useQueryClient();

  const { data, isLoading, error } = useQuery({
    queryKey: ['clients'],
    queryFn: () => api.listClients(),
  });
  const clients = data?.clients ?? [];

  const createMutation = useMutation({
    mutationFn: (body: Parameters<typeof api.createClient>[0]) => api.createClient(body),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['clients'] }); setCreating(false); },
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, body }: { id: string; body: Parameters<typeof api.updateClient>[1] }) => api.updateClient(id, body),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['clients'] }); setEditing(null); },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => api.deleteClient(id),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['clients'] }); setDeleting(null); },
  });

  const buildMenuItems = (client: Client): MenuItem[] => [
    { label: t('clients_actionEdit'), icon: 'pi pi-pencil', command: () => setEditing(client) },
    { separator: true },
    { label: t('clients_actionDelete'), icon: 'pi pi-trash', command: () => setDeleting(client) },
  ];

  const formServerError = (createMutation.error as ApiError | undefined) ?? (updateMutation.error as ApiError | undefined) ?? null;
  const formServerMsg = formServerError?.message ?? null;
  const deleteServerError = deleteMutation.error as ApiError | undefined;
  const deleteServerMsg = deleteServerError?.message ?? null;

  return (
    <AppLayout
      title={t('clients_title')}
      actions={
        <Button label={t('clients_addButton')} icon="pi pi-plus" size="small" onClick={() => setCreating(true)} />
      }
    >
      <p style={{ fontSize: '0.875rem', color: 'var(--text-color-secondary)', margin: '0 0 1rem' }}>
        {t('clients_viewingTenant', { subdomain: subdomain ?? '—' })}
      </p>

      {isLoading ? (
        <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', padding: '5rem 1rem' }}><Spinner /></div>
      ) : error ? (
        <Message severity="error" text={t('clients_errorLoad')} />
      ) : clients.length === 0 ? (
        <EmptyState>{t('clients_empty')}</EmptyState>
      ) : (
        <>
          <Menu ref={menuRef} model={menuItems} popup id="clients_action_menu" />
          <DataTable
            value={clients} dataKey="id" rowHover paginator rows={10}
            removableSort sortMode="multiple" emptyMessage={t('clients_empty')}
            style={{ background: 'var(--surface-card)' }}
          >
            <Column field="name" header={t('clients_colName')} sortable body={(c: Client) => (
              <Link to={'/workspace/clients/' + c.id} style={{ color: 'var(--primary-color)', textDecoration: 'none', fontWeight: 500 }}>{c.name}</Link>
            )} />
            <Column field="email" header={t('clients_colEmail')} sortable body={(c: Client) =>
              c.email ? <a href={'mailto:' + c.email} style={{ color: 'var(--text-color)', textDecoration: 'none' }}>{c.email}</a> : '\u2014'
            } />
            <Column field="phone" header={t('clients_colPhone')} sortable body={(c: Client) => c.phone || '\u2014'} />
            <Column field="createdAt" header={t('clients_colCreated')} sortable body={(c: Client) => format(new Date(c.createdAt), 'MMM d, yyyy')} />
            <Column header="" style={{ width: '3rem', textAlign: 'center' }} body={(c: Client) => (
              <Button icon="pi pi-ellipsis-v" text rounded severity="secondary" size="small"
                aria-label={t('clients_colActions')}
                onClick={(e) => { setMenuItems(buildMenuItems(c)); (menuRef.current as Menu | null)?.toggle(e); }}
              />
            )} />
          </DataTable>
        </>
      )}

      <ClientFormModal
        key={editing?.id ?? 'create'}
        open={creating || editing !== null}
        title={editing ? t('clients_editTitle') : t('clients_addTitle')}
        initialValues={editing ?? undefined}
        serverError={formServerMsg}
        isSubmitting={createMutation.isPending || updateMutation.isPending}
        onClose={() => { setCreating(false); setEditing(null); }}
        onSubmit={(values) => {
          const payload = { name: values.name.trim(), email: clean(values.email), phone: clean(values.phone), notes: clean(values.notes) };
          if (editing) { updateMutation.mutate({ id: editing.id, body: payload }); } else { createMutation.mutate(payload); }
        }}
      />

      <Modal
        open={deleting !== null} title={t('clients_deleteTitle')} onClose={() => setDeleting(null)} size="sm"
        footer={
          <>
            <Button label={t('clients_deleteCancel')} outlined size="small" onClick={() => setDeleting(null)} />
            <Button label={deleteMutation.isPending ? t('common_loading') : t('clients_deleteBtn')}
              severity="danger" size="small" disabled={deleteMutation.isPending}
              onClick={() => { if (deleting) deleteMutation.mutate(deleting.id); }} />
          </>
        }
      >
        {deleteServerMsg && <Message severity="error" text={deleteServerMsg} style={{ marginBottom: '0.75rem' }} />}
        <p style={{ fontSize: '0.875rem', color: 'var(--text-color)' }}>{t('clients_deleteBody', { name: deleting?.name ?? '' })}</p>
      </Modal>
    </AppLayout>
  );
}

// ---------------------------------------------------------------------------
// ClientFormModal
// ---------------------------------------------------------------------------

function ClientFormModal({ open, title, initialValues, serverError, isSubmitting, onClose, onSubmit }: {
  open: boolean; title: string; initialValues?: Client; serverError: string | null;
  isSubmitting: boolean; onClose: () => void; onSubmit: (values: FormValues) => void;
}) {
  const { t } = useI18n();
  const [values, setValues] = useState<FormValues>(
    initialValues
      ? { name: initialValues.name, email: initialValues.email ?? '', phone: initialValues.phone ?? '', notes: initialValues.notes ?? '' }
      : { name: '', email: '', phone: '', notes: '' },
  );
  const [errors, setErrors] = useState<FormErrors>({});
  const [touched, setTouched] = useState<Record<string, boolean>>({});

  const handleChange = (field: keyof FormValues, val: string) => {
    setValues((prev) => ({ ...prev, [field]: val }));
    setTouched((prev) => ({ ...prev, [field]: true }));
    const updated = { ...values, [field]: val };
    const newErrors = validateForm(updated);
    setErrors((prev) => ({ ...prev, [field]: newErrors[field] }));
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const allTouched: Record<string, boolean> = {};
    (Object.keys(values) as (keyof FormValues)[]).forEach((k) => { allTouched[k] = true; });
    setTouched(allTouched);
    const validationErrors = validateForm(values);
    setErrors(validationErrors);
    if (Object.keys(validationErrors).length === 0) onSubmit(values);
  };

  const fieldError = (field: keyof FormErrors) => (touched[field] ? errors[field] : undefined);

  return (
    <Modal open={open} title={title} onClose={onClose} footer={
      <>
        <Button label={t('clients_cancel')} outlined size="small" onClick={onClose} />
        <Button label={isSubmitting ? t('clients_saving') : t('clients_save')} size="small" disabled={isSubmitting} onClick={handleSubmit} />
      </>
    }>
      {serverError && <Message severity="error" text={serverError} style={{ marginBottom: '1rem' }} />}
      <form onSubmit={handleSubmit} noValidate>
        <Field label={t('clients_fieldName')} error={fieldError('name')}>
          <InputText style={{ width: '100%' }} maxLength={160} value={values.name} onChange={(e) => handleChange('name', e.target.value)} />
        </Field>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(14rem, 1fr))', gap: '1rem' }}>
          <Field label={t('clients_fieldEmail')} error={fieldError('email')}>
            <InputText style={{ width: '100%' }} maxLength={254} placeholder="email@example.com" value={values.email} onChange={(e) => handleChange('email', e.target.value)} />
          </Field>
          <Field label={t('clients_fieldPhone')} error={fieldError('phone')}>
            <InputText style={{ width: '100%' }} maxLength={40} placeholder="+40 ..." value={values.phone} onChange={(e) => handleChange('phone', e.target.value)} />
          </Field>
        </div>
        <Field label={t('clients_fieldNotes')} error={fieldError('notes')}>
          <InputTextarea style={{ width: '100%' }} rows={3} maxLength={5000} value={values.notes} onChange={(e) => handleChange('notes', e.target.value)} />
        </Field>
      </form>
    </Modal>
  );
}
