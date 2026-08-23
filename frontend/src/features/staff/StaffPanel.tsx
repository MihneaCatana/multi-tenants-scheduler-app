import { useRef, useState, type ReactNode } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { DataTable } from 'primereact/datatable';
import { Column } from 'primereact/column';
import { Button } from 'primereact/button';
import { InputText } from 'primereact/inputtext';
import { Password } from 'primereact/password';
import { Message } from 'primereact/message';
import { Badge } from 'primereact/badge';
import { Menu } from 'primereact/menu';
import type { MenuItem } from 'primereact/menuitem';
import { api, ApiError } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { AppLayout } from '../../components/AppLayout';
import { Modal } from '../../components/Modal';
import { Spinner } from '../../components/Spinner';
import { EmptyState } from '../../components/EmptyState';
import type { StaffMember } from '../../lib/types';
import { useI18n } from '../../lib/i18n';
import type { Translations } from '../../lib/i18n/translations';

type StatusFilter = 'all' | 'active' | 'inactive';
type EditRole = 'tenant_admin' | 'tenant_user';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Tenant-admin staff management. Lists this tenant's staff (employees who can
 * log in) and exposes update, reset-password, and activate/deactivate actions.
 * A tenant admin cannot change their own role or deactivate themselves (the
 * backend also enforces this).
 */
export function StaffPanel() {
  const qc = useQueryClient();
  const { user: me } = useAuth();
  const { t } = useI18n();
  const [editing, setEditing] = useState<StaffMember | null>(null);
  const [resetFor, setResetFor] = useState<StaffMember | null>(null);
  const [tempPw, setTempPw] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [deleting, setDeleting] = useState<StaffMember | null>(null);
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');

  // Edit form state
  const [editFirstName, setEditFirstName] = useState('');
  const [editLastName, setEditLastName] = useState('');
  const [editRole, setEditRole] = useState<EditRole>('tenant_user');
  const [editErrors, setEditErrors] = useState<Record<string, string>>({});

  // Create form state
  const [createEmail, setCreateEmail] = useState('');
  const [createPassword, setCreatePassword] = useState('');
  const [createFirstName, setCreateFirstName] = useState('');
  const [createLastName, setCreateLastName] = useState('');
  const [createErrors, setCreateErrors] = useState<Record<string, string>>({});

  const { data, isLoading, error } = useQuery({
    queryKey: ['staff', statusFilter !== 'all' ? statusFilter : undefined],
    queryFn: () => api.listStaff({
      limit: 100,
      ...(statusFilter !== 'all' ? { status: statusFilter } : {}),
    }),
  });

  const createMutation = useMutation({
    mutationFn: (v: { email: string; password: string; firstName?: string; lastName?: string }) =>
      api.createStaff({
        email: v.email,
        password: v.password,
        firstName: v.firstName || undefined,
        lastName: v.lastName || undefined,
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['staff'] });
      setCreating(false);
      resetCreateForm();
    },
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, v }: { id: string; v: { firstName?: string; lastName?: string; role: EditRole } }) =>
      api.updateStaff(id, {
        firstName: v.firstName || undefined,
        lastName: v.lastName || undefined,
        role: v.role,
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['staff'] });
      setEditing(null);
    },
  });

  const resetMutation = useMutation({
    mutationFn: (id: string) => api.resetStaffPassword(id),
    onSuccess: (res) => {
      setTempPw(res.temporaryPassword);
      qc.invalidateQueries({ queryKey: ['staff'] });
    },
  });

  const statusMutation = useMutation({
    mutationFn: ({ id, active }: { id: string; active: boolean }) => api.updateStaffStatus(id, active),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['staff'] }),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => api.deleteStaff(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['staff'] });
      setDeleting(null);
    },
  });

  function resetCreateForm() {
    setCreateEmail('');
    setCreatePassword('');
    setCreateFirstName('');
    setCreateLastName('');
    setCreateErrors({});
  }

  const openEdit = (u: StaffMember) => {
    setEditing(u);
    setEditFirstName(u.firstName ?? '');
    setEditLastName(u.lastName ?? '');
    setEditRole(u.role === 'platform_admin' ? 'tenant_user' : u.role);
    setEditErrors({});
  };

  const validateEdit = (): boolean => {
    const e: Record<string, string> = {};
    if (editFirstName.length > 80) e.firstName = 'At most 80 characters';
    if (editLastName.length > 80) e.lastName = 'At most 80 characters';
    if (editRole !== 'tenant_admin' && editRole !== 'tenant_user') e.role = 'Invalid role';
    setEditErrors(e);
    return Object.keys(e).length === 0;
  };

  const submitEdit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!editing) return;
    if (!validateEdit()) return;
    updateMutation.mutate({
      id: editing.id,
      v: { firstName: editFirstName, lastName: editLastName, role: editRole },
    });
  };

  const validateCreate = (): boolean => {
    const e: Record<string, string> = {};
    if (!createEmail.trim() || !EMAIL_RE.test(createEmail) || createEmail.length > 254) {
      e.email = 'Enter a valid email';
    }
    if (createPassword.length < 8) e.password = 'At least 8 characters';
    else if (createPassword.length > 128) e.password = 'At most 128 characters';
    if (createFirstName.length > 80) e.firstName = 'At most 80 characters';
    if (createLastName.length > 80) e.lastName = 'At most 80 characters';
    setCreateErrors(e);
    return Object.keys(e).length === 0;
  };

  const submitCreate = (e: React.FormEvent) => {
    e.preventDefault();
    if (!validateCreate()) return;
    createMutation.mutate({
      email: createEmail,
      password: createPassword,
      firstName: createFirstName,
      lastName: createLastName,
    });
  };

  const busyId = deleteMutation.isPending
    ? deleteMutation.variables
    : statusMutation.isPending
      ? statusMutation.variables?.id
      : resetMutation.isPending
        ? resetMutation.variables
        : undefined;

  const selectStyle: React.CSSProperties = {
    height: '2rem',
    width: '100%',
    maxWidth: '20rem',
    borderRadius: 'var(--content-border-radius)',
    border: '1px solid var(--surface-border)',
    backgroundColor: 'var(--surface-card)',
    color: 'var(--text-color)',
    padding: '0 0.5rem',
    fontSize: '0.875rem',
    cursor: 'pointer',
  };

  return (
    <AppLayout
      title={t('staff_title')}
      actions={
        <Button
          type="button"
          size="small"
          label={t('staff_addButton')}
          onClick={() => { resetCreateForm(); setCreating(true); }}
        />
      }
    >
      <p style={{ margin: '0 0 1rem', fontSize: '0.875rem', color: 'var(--text-color-secondary)' }}>
        {t('staff_description')}
      </p>

      <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '1rem' }}>
        <label style={{ fontSize: '0.875rem', fontWeight: 500, color: 'var(--text-color)' }}>
          Status
        </label>
        <select
          style={selectStyle}
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value as StatusFilter)}
        >
          <option value="all">All</option>
          <option value="active">Active</option>
          <option value="inactive">Inactive</option>
        </select>
      </div>

      {isLoading ? (
        <div style={{ display: 'flex', justifyContent: 'center', padding: '4rem 0' }}>
          <Spinner />
        </div>
      ) : error ? (
        <Message
          severity="error"
          text={error instanceof ApiError ? error.message : t('staff_errorLoad')}
        />
      ) : (
        <StaffTable
          staff={data?.staff ?? []}
          selfId={me?.id}
          onEdit={openEdit}
          onReset={(u) => {
            setResetFor(u);
            setTempPw(null);
          }}
          onStatus={(u, active) => statusMutation.mutate({ id: u.id, active })}
          onDelete={(u) => setDeleting(u)}
          busyId={busyId}
          t={t}
        />
      )}

      {/* Edit modal */}
      <Modal
        open={editing !== null}
        title={t('staff_editTitle')}
        onClose={() => setEditing(null)}
        footer={
          <>
            <Button type="button" outlined severity="secondary" size="small" onClick={() => setEditing(null)}>
              {t('staff_editCancelBtn')}
            </Button>
            <Button type="submit" form="staff-edit-form" size="small" disabled={updateMutation.isPending}>
              {updateMutation.isPending ? t('staff_editSaving') : t('staff_editSave')}
            </Button>
          </>
        }
      >
        <form id="staff-edit-form" onSubmit={submitEdit} style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
          <Field label={t('staff_colEmail')}>
            <InputText value={editing?.email ?? ''} disabled style={{ width: '100%' }} />
          </Field>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem' }}>
            <Field label={t('profile_firstName')} error={editErrors.firstName}>
              <InputText value={editFirstName} onChange={(e) => setEditFirstName(e.target.value)} style={{ width: '100%' }} />
            </Field>
            <Field label={t('profile_lastName')} error={editErrors.lastName}>
              <InputText value={editLastName} onChange={(e) => setEditLastName(e.target.value)} style={{ width: '100%' }} />
            </Field>
          </div>
          <Field label={t('staff_colRole')} error={editErrors.role}>
            <select
              style={{ ...selectStyle, maxWidth: 'none' }}
              value={editRole}
              onChange={(e) => setEditRole(e.target.value as EditRole)}
              disabled={editing?.id === me?.id}
            >
              <option value="tenant_user">tenant_user</option>
              <option value="tenant_admin">tenant_admin</option>
            </select>
            {editing?.id === me?.id && (
              <p style={{ margin: '0.25rem 0 0', fontSize: '0.75rem', color: 'var(--text-color-secondary)' }}>
                {t('staff_editCannotChangeRole')}
              </p>
            )}
          </Field>
          {updateMutation.error ? (
            <Message
              severity="error"
              text={updateMutation.error instanceof ApiError ? updateMutation.error.message : t('staff_editSaveFailed')}
            />
          ) : null}
        </form>
      </Modal>

      {/* Reset password modal */}
      <Modal
        open={resetFor !== null}
        title={tempPw ? t('staff_resetTitleDone') : t('staff_resetTitle')}
        onClose={() => { setResetFor(null); setTempPw(null); }}
        footer={
          tempPw ? (
            <Button type="button" size="small" onClick={() => { setResetFor(null); setTempPw(null); }}>
              {t('staff_resetDone')}
            </Button>
          ) : (
            <>
              <Button type="button" outlined severity="secondary" size="small" onClick={() => setResetFor(null)}>
                {t('staff_resetCancel')}
              </Button>
              <Button
                type="button"
                severity="danger"
                size="small"
                disabled={resetMutation.isPending}
                onClick={() => resetFor && resetMutation.mutate(resetFor.id)}
              >
                {resetMutation.isPending ? t('staff_resetResetting') : t('staff_resetBtn')}
              </Button>
            </>
          )
        }
      >
        {tempPw ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
            <p style={{ fontSize: '0.875rem', color: 'var(--text-color-secondary)' }}>
              {t('staff_resetTempPwBody', { email: resetFor?.email ?? '' })}
            </p>
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '0.5rem',
                borderRadius: 'var(--content-border-radius)',
                padding: '0.5rem 0.75rem',
                backgroundColor: 'var(--surface-ground)',
                border: '1px solid var(--surface-border)',
              }}
            >
              <code style={{ flex: 1, fontFamily: 'monospace', fontSize: '0.875rem', color: 'var(--text-color)' }}>
                {tempPw}
              </code>
              <Button
                type="button"
                outlined
                severity="secondary"
                size="small"
                label={t('staff_resetCopy')}
                onClick={() => navigator.clipboard?.writeText(tempPw)}
              />
            </div>
          </div>
        ) : (
          <p style={{ fontSize: '0.875rem', color: 'var(--text-color-secondary)' }}>
            {t('staff_resetBody', { email: resetFor?.email ?? '' })}
          </p>
        )}
      </Modal>

      {/* Create staff modal */}
      <Modal
        open={creating}
        title={t('staff_createTitle')}
        onClose={() => setCreating(false)}
        footer={
          <>
            <Button type="button" outlined severity="secondary" size="small" onClick={() => setCreating(false)}>
              {t('staff_createCancel')}
            </Button>
            <Button type="submit" form="staff-create-form" size="small" disabled={createMutation.isPending}>
              {createMutation.isPending ? t('staff_createCreating') : t('staff_createBtn')}
            </Button>
          </>
        }
      >
        <form id="staff-create-form" onSubmit={submitCreate} style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
          <Field label={t('staff_colEmail')} error={createErrors.email}>
            <InputText
              type="email"
              autoComplete="email"
              value={createEmail}
              onChange={(e) => setCreateEmail(e.target.value)}
              style={{ width: '100%' }}
            />
          </Field>
          <Field label={t('auth_passwordLabel')} error={createErrors.password}>
            <Password
              toggleMask
              feedback={false}
              autoComplete="new-password"
              value={createPassword}
              onChange={(e) => setCreatePassword(e.target.value)}
              inputStyle={{ width: '100%' }}
              style={{ width: '100%' }}
            />
          </Field>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem' }}>
            <Field label={t('profile_firstName')} error={createErrors.firstName}>
              <InputText value={createFirstName} onChange={(e) => setCreateFirstName(e.target.value)} style={{ width: '100%' }} />
            </Field>
            <Field label={t('profile_lastName')} error={createErrors.lastName}>
              <InputText value={createLastName} onChange={(e) => setCreateLastName(e.target.value)} style={{ width: '100%' }} />
            </Field>
          </div>
          <p style={{ fontSize: '0.75rem', color: 'var(--text-color-secondary)' }}>
            {t('staff_createRoleNote')}
          </p>
          {createMutation.error ? (
            <Message
              severity="error"
              text={createMutation.error instanceof ApiError ? createMutation.error.message : t('staff_createFailed')}
            />
          ) : null}
        </form>
      </Modal>

      {/* Delete staff confirmation modal */}
      <Modal
        open={deleting !== null}
        title={t('staff_deleteTitle')}
        onClose={() => setDeleting(null)}
        footer={
          <>
            <Button type="button" outlined severity="secondary" size="small" onClick={() => setDeleting(null)}>
              {t('staff_deleteCancel')}
            </Button>
            <Button
              type="button"
              severity="danger"
              size="small"
              disabled={deleteMutation.isPending}
              onClick={() => deleting && deleteMutation.mutate(deleting.id)}
            >
              {deleteMutation.isPending ? t('staff_deleteDeleting') : t('staff_deleteBtn')}
            </Button>
          </>
        }
      >
        <p style={{ fontSize: '0.875rem', color: 'var(--text-color-secondary)' }}>
          {t('staff_deleteBody', { email: deleting?.email ?? '' })}
        </p>
        {deleteMutation.error ? (
          <div style={{ marginTop: '0.5rem' }}>
            <Message
              severity="error"
              text={deleteMutation.error instanceof ApiError ? deleteMutation.error.message : t('common_error')}
            />
          </div>
        ) : null}
      </Modal>

      {statusMutation.error ? (
        <div style={{ marginTop: '0.75rem' }}>
          <Message
            severity="error"
            text={statusMutation.error instanceof ApiError ? statusMutation.error.message : t('common_error')}
          />
        </div>
      ) : null}
    </AppLayout>
  );
}

function StaffTable({
  staff,
  selfId,
  onEdit,
  onReset,
  onStatus,
  onDelete,
  busyId,
  t,
}: {
  staff: StaffMember[];
  selfId?: string;
  onEdit: (u: StaffMember) => void;
  onReset: (u: StaffMember) => void;
  onStatus: (u: StaffMember, active: boolean) => void;
  onDelete: (u: StaffMember) => void;
  busyId?: string;
  t: (key: keyof Translations, vars?: Record<string, string>) => string;
}) {
  const menuRef = useRef<Menu>(null);
  const [activeRow, setActiveRow] = useState<StaffMember | null>(null);

  const openActions = (e: React.MouseEvent, u: StaffMember) => {
    setActiveRow(u);
    menuRef.current?.toggle(e);
  };

  const actionItems: MenuItem[] = activeRow
    ? [
        {
          label: t('staff_actionEdit'),
          icon: 'pi pi-pencil',
          command: () => onEdit(activeRow),
        },
        {
          label: busyId === activeRow.id ? '…' : t('staff_actionResetPw'),
          icon: 'pi pi-key',
          disabled: busyId === activeRow.id,
          command: () => onReset(activeRow),
        },
        { separator: true },
        ...(activeRow.active
          ? [
              {
                label: t('staff_actionDeactivate'),
                icon: 'pi pi-user-minus',
                disabled: busyId === activeRow.id || activeRow.id === selfId,
                command: () => onStatus(activeRow, false),
              },
            ]
          : [
              {
                label: t('staff_actionActivate'),
                icon: 'pi pi-user-plus',
                disabled: busyId === activeRow.id,
                command: () => onStatus(activeRow, true),
              },
              ...(activeRow.id !== selfId
                ? [
                    {
                      label: t('staff_actionDelete'),
                      icon: 'pi pi-trash',
                      disabled: busyId === activeRow.id,
                      command: () => onDelete(activeRow),
                    },
                  ]
                : []),
            ]),
      ]
    : [];

  if (staff.length === 0) {
    return <EmptyState>{t('staff_empty')}</EmptyState>;
  }

  return (
    <div
      style={{
        backgroundColor: 'var(--surface-card)',
        border: '1px solid var(--surface-border)',
        borderRadius: 'var(--content-border-radius)',
        overflowX: 'auto',
      }}
    >
      <Menu model={actionItems} popup ref={menuRef} />
      <DataTable
        value={staff}
        dataKey="id"
        rowHover
        paginator
        rows={10}
        responsiveLayout="scroll"
        style={{ fontSize: '0.875rem' }}
      >
        <Column
          field="email"
          header={t('staff_colEmail')}
          sortable
          body={(row: StaffMember) => (
            <span style={{ fontWeight: 600, color: 'var(--text-color)' }}>
              {row.email}
              {row.id === selfId && (
                <span style={{ marginLeft: '0.25rem', fontSize: '0.75rem', fontWeight: 400, color: 'var(--text-color-secondary)' }}>
                  {t('staff_tagYou')}
                </span>
              )}
            </span>
          )}
        />
        <Column
          field="name"
          header={t('staff_colName')}
          sortable
          body={(row: StaffMember) => (
            <span style={{ color: 'var(--text-color-secondary)' }}>
              {[row.firstName, row.lastName].filter(Boolean).join(' ') || '—'}
            </span>
          )}
        />
        <Column
          field="role"
          header={t('staff_colRole')}
          sortable
          body={(row: StaffMember) => (
            <span style={{ fontFamily: 'monospace', fontSize: '0.75rem', color: 'var(--text-color-secondary)' }}>
              {row.role}
            </span>
          )}
        />
        <Column
          field="active"
          header={t('staff_colStatus')}
          sortable
          body={(row: StaffMember) => (
            <Badge
              value={row.active ? t('staff_statusActive') : t('staff_statusInactive')}
              severity={row.active ? 'success' : 'warning'}
            />
          )}
        />
        <Column
          header={t('staff_colActions')}
          body={(row: StaffMember) => (
            <Button
              type="button"
              icon="pi pi-ellipsis-v"
              text
              rounded
              size="small"
              aria-label={t('staff_colActions')}
              onClick={(e) => openActions(e, row)}
            />
          )}
          style={{ width: '4rem', textAlign: 'center' }}
        />
      </DataTable>
    </div>
  );
}

function Field({
  label,
  error,
  children,
}: {
  label: string;
  error?: string;
  children: ReactNode;
}) {
  return (
    <div>
      <label style={{ display: 'block', marginBottom: '0.25rem', fontSize: '0.875rem', fontWeight: 500, color: 'var(--text-color)' }}>
        {label}
      </label>
      {children}
      {error && <small className="field-error">{error}</small>}
    </div>
  );
}
