import { useState, useRef, forwardRef, useImperativeHandle, type ReactNode } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { DataTable } from 'primereact/datatable';
import { Column } from 'primereact/column';
import { Button } from 'primereact/button';
import { InputText } from 'primereact/inputtext';
import { InputTextarea } from 'primereact/inputtextarea';
import { InputSwitch } from 'primereact/inputswitch';
import { Dropdown } from 'primereact/dropdown';
import { Badge } from 'primereact/badge';
import { Menu } from 'primereact/menu';
import type { MenuItem } from 'primereact/menuitem';
import { Message } from 'primereact/message';
import { Calendar } from 'primereact/calendar';

import { api, ApiError } from '../../../lib/api';
import { Modal } from '../../../components/Modal';
import { Spinner } from '../../../components/Spinner';
import { EmptyState } from '../../../components/EmptyState';
import { getResourceTypeLabels, getDayLabels } from '../../calendar/lifecycle';
import { useI18n } from '../../../lib/i18n';
import type { Resource, StaffMember, WorkingHour, TimeOff } from '../../../lib/types';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface ResourceFormValues {
  name: string;
  type: string;
  linkedStaffId: string;
  notes: string;
  isActive: boolean;
}

interface ResourceFormErrors {
  name?: string;
  type?: string;
  linkedStaffId?: string;
  notes?: string;
}

interface WhFormValues {
  dayOfWeek: number;
  startTime: string;
  endTime: string;
  validFrom: string;
  validTo: string;
}

interface WhFormErrors {
  dayOfWeek?: string;
  startTime?: string;
  endTime?: string;
  validFrom?: string;
  validTo?: string;
}

interface ToFormValues {
  startAt: Date | null;
  endAt: Date | null;
  reason: string;
}

interface ToFormErrors {
  startAt?: string;
  endAt?: string;
  reason?: string;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function clean(val: string | undefined): string | undefined {
  if (!val || val.trim() === '') return undefined;
  return val.trim();
}

function validateResourceForm(values: ResourceFormValues): ResourceFormErrors {
  const errors: ResourceFormErrors = {};
  if (!values.name.trim()) errors.name = 'Required';
  else if (values.name.length > 120) errors.name = 'Max 120 characters';
  if (!['provider', 'room', 'equipment', 'chair'].includes(values.type)) {
    errors.type = 'Invalid type';
  }
  if (values.type === 'provider' && (!values.linkedStaffId || values.linkedStaffId.trim() === '')) {
    errors.linkedStaffId = 'A provider must be linked to a staff member';
  }
  if (values.type !== 'provider' && values.linkedStaffId && values.linkedStaffId.trim() !== '') {
    errors.linkedStaffId = 'Only providers can be linked to staff';
  }
  if (values.notes.length > 5000) errors.notes = 'Max 5000 characters';
  return errors;
}

function validateWhForm(values: WhFormValues): WhFormErrors {
  const errors: WhFormErrors = {};
  if (values.dayOfWeek < 0 || values.dayOfWeek > 6) errors.dayOfWeek = 'Invalid day';
  if (!values.startTime.trim()) errors.startTime = 'Required';
  if (!values.endTime.trim()) errors.endTime = 'Required';
  if (!values.validFrom.trim()) errors.validFrom = 'Required';
  return errors;
}

function validateToForm(values: ToFormValues): ToFormErrors {
  const errors: ToFormErrors = {};
  if (!values.startAt) errors.startAt = 'Required';
  if (!values.endAt) errors.endAt = 'Required';
  if (values.reason.length > 200) errors.reason = 'Max 200 characters';
  return errors;
}

// ---------------------------------------------------------------------------
// Field component
// ---------------------------------------------------------------------------

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
    <div style={{ marginBottom: '1rem' }}>
      <label style={{ fontSize: '0.875rem', fontWeight: 500, color: 'var(--text-color)' }}>{label}</label>
      {children}
      {error && <small className="field-error" style={{ color: 'var(--red-500)' }}>{error}</small>}
    </div>
  );
}

// ---------------------------------------------------------------------------
// ResourcesTab
// ---------------------------------------------------------------------------

export const ResourcesTab = forwardRef(function ResourcesTab(_props, ref) {
  const { t } = useI18n();
  const queryClient = useQueryClient();

  // --- State ---
  const [creating, setCreating] = useState(false);

  useImperativeHandle(ref, () => ({ openCreate: () => setCreating(true) }), []);
  const [editing, setEditing] = useState<Resource | null>(null);
  const [deleting, setDeleting] = useState<Resource | null>(null);
  const [scheduleResource, setScheduleResource] = useState<Resource | null>(null);
  const menuRef = useRef<Menu>(null);
  const [menuItems, setMenuItems] = useState<MenuItem[]>([]);

  // --- Queries ---
  const {
    data: resourcesData,
    isLoading: resourcesLoading,
    error: resourcesError,
  } = useQuery({
    queryKey: ['resources'],
    queryFn: () => api.listResources(),
  });

  const { data: staffData } = useQuery({
    queryKey: ['staff'],
    queryFn: () => api.listStaff({ limit: 100 }),
  });

  const resources = resourcesData?.resources ?? [];
  const staff = staffData?.staff ?? [];
  const staffMap = new Map<string, StaffMember>(staff.map((s) => [s.id, s]));

  // --- Mutations ---
  const createMutation = useMutation({
    mutationFn: (body: Parameters<typeof api.createResource>[0]) => api.createResource(body),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['resources'] });
      setCreating(false);
    },
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, body }: { id: string; body: Parameters<typeof api.updateResource>[1] }) =>
      api.updateResource(id, body),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['resources'] });
      setEditing(null);
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => api.deleteResource(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['resources'] });
      setDeleting(null);
    },
  });

  // --- Menu items for row actions ---
  const buildMenuItems = (r: Resource) => [
    {
      label: t('res_actionEdit'),
      icon: 'pi pi-pencil',
      command: () => setEditing(r),
    },
    {
      label: t('res_actionSchedule'),
      icon: 'pi pi-calendar',
      command: () => setScheduleResource(r),
    },
    { separator: true },
    {
      label: t('res_actionDelete'),
      icon: 'pi pi-trash',
      command: () => setDeleting(r),
    },
  ];

  // --- Schedule sub-panel ---
  if (scheduleResource) {
    return (
      <SchedulePanel
        resource={scheduleResource}
        staffMap={staffMap}
        onBack={() => setScheduleResource(null)}
      />
    );
  }

  // --- Main page ---
  const resourceTypeLabels = getResourceTypeLabels(t);

  const formServerError =
    (createMutation.error as ApiError | undefined) ??
    (updateMutation.error as ApiError | undefined) ??
    null;
  const formServerMsg = formServerError?.message ?? null;

  const deleteServerError = deleteMutation.error as ApiError | undefined;
  const deleteServerMsg = deleteServerError?.message ?? null;

  return (
    <>
      {/* Loading / Error / Empty */}
      {resourcesLoading ? (
        <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', padding: '5rem 1rem' }}>
          <Spinner />
        </div>
      ) : resourcesError ? (
        <Message
          severity="error"
          text={resourcesError instanceof ApiError ? resourcesError.message : t('res_errorLoad')}
          style={{ marginBottom: '0.75rem' }}
        />
      ) : resources.length === 0 ? (
        <EmptyState>{t('res_noResources')}</EmptyState>
      ) : (
        /* Resources Table */
        <>
          <Menu ref={menuRef} model={menuItems} popup id="resources_action_menu" />
          <DataTable
            value={resources}
            dataKey="id"
            rowHover
            paginator
            rows={10}
            removableSort
            sortMode="multiple"
            emptyMessage={t('res_noResources')}
            style={{ background: 'var(--surface-card)' }}
          >
            <Column
              field="name"
              header={t('res_colName')}
              sortable
              body={(r: Resource) => (
                <span style={{ fontWeight: 500 }}>{r.name}</span>
              )}
            />
            <Column
              field="type"
              header={t('res_colType')}
              sortable
              body={(r: Resource) => (
                <Badge
                  value={resourceTypeLabels[r.type as keyof typeof resourceTypeLabels] ?? r.type}
                  severity="info"
                />
              )}
            />
            <Column
              field="linkedStaff"
              header={t('res_colLinkedStaff')}
              body={(r: Resource) => {
                const linked =
                  r.type === 'provider' && r.linkedStaffId
                    ? staffMap.get(r.linkedStaffId)
                    : undefined;
                return linked
                  ? [linked.firstName, linked.lastName].filter(Boolean).join(' ') || linked.email
                  : '\u2014';
              }}
            />
            <Column
              field="isActive"
              header={t('res_colStatus')}
              sortable
              body={(r: Resource) => (
                <Badge
                  value={r.isActive ? t('res_statusActive') : t('res_statusInactive')}
                  severity={r.isActive ? 'success' : 'warning'}
                />
              )}
            />
            <Column
              header=""
              style={{ width: '3rem', textAlign: 'center' }}
              body={(r: Resource) => (
                <Button
                  icon="pi pi-ellipsis-v"
                  rounded
                  severity="secondary"
                  size="small"
                  onClick={(e) => {
                    setMenuItems(buildMenuItems(r));
                    (menuRef.current as Menu | null)?.toggle(e);
                  }}
                />
              )}
            />
          </DataTable>
        </>
      )}

      {/* ----------------------------------------------------------------- */}
      {/* Create / Edit Resource Modal */}
      {/* ----------------------------------------------------------------- */}
      <ResourceFormModal
        key={editing?.id ?? 'create'}
        open={creating || editing !== null}
        title={editing ? t('res_formEditTitle') : t('res_formAddTitle')}
        initialValues={editing ?? undefined}
        staff={staff}
        serverError={formServerMsg}
        isSubmitting={createMutation.isPending || updateMutation.isPending}
        onClose={() => {
          setCreating(false);
          setEditing(null);
        }}
        onSubmit={(values) => {
          const payload = {
            name: values.name,
            type: values.type as 'provider' | 'room' | 'equipment' | 'chair',
            linkedStaffId: clean(values.linkedStaffId),
            notes: clean(values.notes),
            ...(editing ? { isActive: values.isActive } : {}),
          };
          if (editing) {
            updateMutation.mutate({ id: editing.id, body: payload });
          } else {
            createMutation.mutate(payload);
          }
        }}
      />

      {/* ----------------------------------------------------------------- */}
      {/* Delete Confirmation Modal */}
      {/* ----------------------------------------------------------------- */}
      <Modal
        open={deleting !== null}
        title={t('res_deleteTitle')}
        onClose={() => setDeleting(null)}
        size="sm"
        footer={
          <>
            <Button
              label={t('common_cancel')}
              outlined
              size="small"
              onClick={() => setDeleting(null)}
            />
            <Button
              label={deleteMutation.isPending ? t('common_loading') : t('res_actionDelete')}
              severity="danger"
              size="small"
              disabled={deleteMutation.isPending}
              onClick={() => {
                if (deleting) deleteMutation.mutate(deleting.id);
              }}
            />
          </>
        }
      >
        {deleteServerMsg && (
          <Message severity="error" text={deleteServerMsg} style={{ marginBottom: '0.75rem' }} />
        )}
        <p style={{ fontSize: '0.875rem', color: 'var(--text-color)' }}>
          {t('res_deleteBody', { name: deleting?.name ?? '' })}
        </p>
      </Modal>
    </>
  );
})

// ---------------------------------------------------------------------------
// ResourceFormModal
// ---------------------------------------------------------------------------

function ResourceFormModal({
  open,
  title,
  initialValues,
  staff,
  serverError,
  isSubmitting,
  onClose,
  onSubmit,
}: {
  open: boolean;
  title: string;
  initialValues?: Resource;
  staff: StaffMember[];
  serverError: string | null;
  isSubmitting: boolean;
  onClose: () => void;
  onSubmit: (values: ResourceFormValues) => void;
}) {
  const { t } = useI18n();

  const [values, setValues] = useState<ResourceFormValues>(
    initialValues
      ? {
          name: initialValues.name,
          type: initialValues.type,
          linkedStaffId: initialValues.linkedStaffId ?? '',
          notes: initialValues.notes ?? '',
          isActive: initialValues.isActive,
        }
      : {
          name: '',
          type: 'room',
          linkedStaffId: '',
          notes: '',
          isActive: true,
        },
  );

  const [errors, setErrors] = useState<ResourceFormErrors>({});
  const [touched, setTouched] = useState<Record<string, boolean>>({});

  const handleChange = (field: keyof ResourceFormValues, val: string | boolean) => {
    setValues((prev) => ({ ...prev, [field]: val }));
    setTouched((prev) => ({ ...prev, [field]: true }));
    const updated = { ...values, [field]: val };
    const newErrors = validateResourceForm(updated as ResourceFormValues);
    setErrors((prev) => ({ ...prev, [field]: newErrors[field as keyof ResourceFormErrors] }));
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const allTouched: Record<string, boolean> = {};
    (Object.keys(values) as (keyof ResourceFormValues)[]).forEach((k) => {
      allTouched[k] = true;
    });
    setTouched(allTouched);
    const validationErrors = validateResourceForm(values);
    setErrors(validationErrors);
    if (Object.keys(validationErrors).length === 0) {
      onSubmit(values);
    }
  };

  const fieldError = (field: keyof ResourceFormErrors) => (touched[field] ? errors[field] : undefined);

  const resourceTypeLabels = getResourceTypeLabels(t);
  const typeOptions = (Object.keys(resourceTypeLabels) as Array<keyof typeof resourceTypeLabels>).map((k) => ({
    label: resourceTypeLabels[k],
    value: k,
  }));

  const staffOptions = [
    { label: t('res_selectStaffPlaceholder'), value: '' },
    ...staff.map((s) => ({
      label: [s.firstName, s.lastName].filter(Boolean).join(' ') || s.email,
      value: s.id,
    })),
  ];

  return (
    <Modal
      open={open}
      title={title}
      onClose={onClose}
      footer={
        <>
          <Button label={t('common_cancel')} outlined size="small" onClick={onClose} />
          <Button
            label={isSubmitting ? t('res_formSaving') : t('common_save')}
            size="small"
            disabled={isSubmitting}
            onClick={handleSubmit}
          />
        </>
      }
    >
      {serverError && (
        <Message severity="error" text={serverError} style={{ marginBottom: '1rem' }} />
      )}

      <form onSubmit={handleSubmit} noValidate>
        <Field label={t('res_fieldName')} error={fieldError('name')}>
          <InputText
            style={{ width: '100%' }}
            maxLength={120}
            value={values.name}
            onChange={(e) => handleChange('name', e.target.value)}
          />
        </Field>

        <Field label={t('res_fieldType')} error={fieldError('type')}>
          <Dropdown
            style={{ width: '100%' }}
            value={values.type}
            options={typeOptions}
            onChange={(e) => handleChange('type', e.value)}
          />
        </Field>

        {values.type === 'provider' && (
          <Field label={t('res_fieldLinkedStaff')} error={fieldError('linkedStaffId')}>
            <Dropdown
              style={{ width: '100%' }}
              value={values.linkedStaffId || null}
              options={staffOptions}
              onChange={(e) => handleChange('linkedStaffId', e.value ?? '')}
              placeholder={t('res_selectStaffPlaceholder')}
            />
          </Field>
        )}

        <Field label={t('res_fieldNotes')} error={fieldError('notes')}>
          <InputTextarea
            style={{ width: '100%' }}
            rows={3}
            maxLength={5000}
            value={values.notes}
            onChange={(e) => handleChange('notes', e.target.value)}
          />
        </Field>

        {initialValues && (
          <Field label={t('res_fieldActive')}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              <InputSwitch
                checked={values.isActive}
                onChange={(e) => handleChange('isActive', e.value ?? false)}
              />
              <span style={{ fontSize: '0.875rem', color: 'var(--text-color)' }}>
                {values.isActive ? t('res_statusActive') : t('res_statusInactive')}
              </span>
            </div>
          </Field>
        )}
      </form>
    </Modal>
  );
}

// ---------------------------------------------------------------------------
// SchedulePanel (WorkingHoursPanel + TimeOffPanel)
// ---------------------------------------------------------------------------

function SchedulePanel({
  resource,
  staffMap,
  onBack,
}: {
  resource: Resource;
  staffMap: Map<string, StaffMember>;
  onBack: () => void;
}) {
  const { t } = useI18n();
  const queryClient = useQueryClient();
  const dayLabels = getDayLabels(t);

  const linkedStaff =
    resource.type === 'provider' && resource.linkedStaffId
      ? staffMap.get(resource.linkedStaffId)
      : undefined;

  // --- Working Hours State ---
  const [creatingWH, setCreatingWH] = useState(false);
  const [editingWH, setEditingWH] = useState<WorkingHour | null>(null);
  const [deletingWH, setDeletingWH] = useState<WorkingHour | null>(null);
  const whMenuRef = useRef<Menu>(null);
  const [whMenuItems, setWhMenuItems] = useState<MenuItem[]>([]);

  // --- Time Off State ---
  const [creatingTO, setCreatingTO] = useState(false);
  const [deletingTO, setDeletingTO] = useState<TimeOff | null>(null);
  const toMenuRef = useRef<Menu>(null);
  const [toMenuItems, setToMenuItems] = useState<MenuItem[]>([]);

  // --- Working Hours Queries ---
  const {
    data: whData,
    isLoading: whLoading,
  } = useQuery({
    queryKey: ['resources', resource.id, 'working-hours'],
    queryFn: () => api.listWorkingHours(resource.id),
  });

  const workingHours = whData?.workingHours ?? [];

  // --- Time Off Queries ---
  const {
    data: toData,
    isLoading: toLoading,
  } = useQuery({
    queryKey: ['resources', resource.id, 'time-off'],
    queryFn: () => api.listTimeOff(resource.id),
  });

  const timeOffList = toData?.timeOff ?? [];

  // --- Working Hours Mutations ---
  const whMutation = useMutation({
    mutationFn: ({ id, body }: { id?: string; body: Parameters<typeof api.createWorkingHour>[1] }) =>
      id ? api.updateWorkingHour(id, body) : api.createWorkingHour(resource.id, body),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['resources', resource.id, 'working-hours'] });
      setCreatingWH(false);
      setEditingWH(null);
    },
  });

  const deleteWHMutation = useMutation({
    mutationFn: (id: string) => api.deleteWorkingHour(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['resources', resource.id, 'working-hours'] });
      setDeletingWH(null);
    },
  });

  // --- Time Off Mutations ---
  const toMutation = useMutation({
    mutationFn: (body: { startAt: string; endAt: string; reason?: string }) =>
      api.createTimeOff(resource.id, body),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['resources', resource.id, 'time-off'] });
      setCreatingTO(false);
    },
  });

  const deleteTOMutation = useMutation({
    mutationFn: (id: string) => api.deleteTimeOff(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['resources', resource.id, 'time-off'] });
      setDeletingTO(null);
    },
  });

  // --- Working Hours Menu ---
  const buildWHMenuItems = (wh: WorkingHour) => [
    {
      label: t('res_actionEdit'),
      icon: 'pi pi-pencil',
      command: () => setEditingWH(wh),
    },
    { separator: true },
    {
      label: t('res_actionDelete'),
      icon: 'pi pi-trash',
      command: () => setDeletingWH(wh),
    },
  ];

  // --- Time Off Menu ---
  const buildTOMenuItems = (to: TimeOff) => [
    {
      label: t('res_actionDelete'),
      icon: 'pi pi-trash',
      command: () => setDeletingTO(to),
    },
  ];

  // --- Day options for WH dropdown ---
  const dayOptions = Object.entries(dayLabels).map(([num, label]) => ({
    label,
    value: Number(num),
  }));

  return (
    <>
      {/* Back header */}
      <div style={{ marginBottom: '1rem' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div>
            <h2 style={{ fontSize: '1.125rem', fontWeight: 600, margin: 0, color: 'var(--text-color)' }}>
              {resource.name}
              {linkedStaff && (
                <span style={{ marginLeft: '0.5rem', fontWeight: 400, fontSize: '0.875rem', color: 'var(--text-color-secondary)' }}>
                  ({[linkedStaff.firstName, linkedStaff.lastName].filter(Boolean).join(' ') || linkedStaff.email})
                </span>
              )}
            </h2>
          </div>
          <Button
            label={t('res_backToResources')}
            icon="pi pi-arrow-left"
            outlined
            size="small"
            onClick={onBack}
          />
        </div>
      </div>

      {/* =============================================================== */}
      {/* Working Hours Panel */}
      {/* =============================================================== */}
      <div style={{ marginBottom: '1.5rem' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.5rem' }}>
          <h3 style={{ fontSize: '0.875rem', fontWeight: 600, margin: 0, color: 'var(--text-color)' }}>
            {t('res_workingHours')}
          </h3>
          <Button
            label={t('res_addBtn')}
            icon="pi pi-plus"
            size="small"
            onClick={() => setCreatingWH(true)}
          />
        </div>

        {whLoading ? (
          <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', padding: '3rem 1rem' }}>
            <Spinner />
          </div>
        ) : workingHours.length === 0 ? (
          <div style={{ padding: '1.5rem', textAlign: 'center', fontSize: '0.875rem', color: 'var(--text-color-secondary)' }}>
            {t('res_noWorkingHours')}
          </div>
        ) : (
          <>
            <Menu ref={whMenuRef} model={whMenuItems} popup id="wh_action_menu" />
            <DataTable
              value={workingHours}
              dataKey="id"
              rowHover
              paginator={false}
              style={{ background: 'var(--surface-card)' }}
            >
              <Column
                header={t('res_whColDay')}
                body={(wh: WorkingHour) => dayLabels[wh.dayOfWeek] ?? wh.dayOfWeek}
              />
              <Column
                header={t('res_whColStartTime')}
                body={(wh: WorkingHour) => wh.startTime.slice(0, 5)}
              />
              <Column
                header={t('res_whColEndTime')}
                body={(wh: WorkingHour) => wh.endTime.slice(0, 5)}
              />
              <Column
                header={t('res_whColValidFrom')}
                body={(wh: WorkingHour) => wh.validFrom}
              />
              <Column
                header={t('res_whColValidTo')}
                body={(wh: WorkingHour) => wh.validTo ?? t('res_whOngoing')}
              />
              <Column
                header=""
                style={{ width: '3rem', textAlign: 'center' }}
                body={(wh: WorkingHour) => (
                  <Button
                    icon="pi pi-ellipsis-v"
                    text
                    rounded
                    severity="secondary"
                    size="small"
                    onClick={(e) => {
                      setWhMenuItems(buildWHMenuItems(wh));
                      (whMenuRef.current as Menu | null)?.toggle(e);
                    }}
                  />
                )}
              />
            </DataTable>
          </>
        )}
      </div>

      {/* =============================================================== */}
      {/* Time Off Panel */}
      {/* =============================================================== */}
      <div>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.5rem' }}>
          <h3 style={{ fontSize: '0.875rem', fontWeight: 600, margin: 0, color: 'var(--text-color)' }}>
            {t('res_timeOff')}
          </h3>
          <Button
            label={t('res_addBtn')}
            icon="pi pi-plus"
            size="small"
            onClick={() => setCreatingTO(true)}
          />
        </div>

        {toLoading ? (
          <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', padding: '3rem 1rem' }}>
            <Spinner />
          </div>
        ) : timeOffList.length === 0 ? (
          <div style={{ padding: '1.5rem', textAlign: 'center', fontSize: '0.875rem', color: 'var(--text-color-secondary)' }}>
            {t('res_noTimeOff')}
          </div>
        ) : (
          <>
            <Menu ref={toMenuRef} model={toMenuItems} popup id="to_action_menu" />
            <DataTable
              value={timeOffList}
              dataKey="id"
              rowHover
              paginator={false}
              style={{ background: 'var(--surface-card)' }}
            >
              <Column
                header={t('res_toColStart')}
                body={(to: TimeOff) => new Date(to.startAt).toLocaleString()}
              />
              <Column
                header={t('res_toColEnd')}
                body={(to: TimeOff) => new Date(to.endAt).toLocaleString()}
              />
              <Column
                header={t('res_toColReason')}
                body={(to: TimeOff) => to.reason ?? '\u2014'}
              />
              <Column
                header=""
                style={{ width: '3rem', textAlign: 'center' }}
                body={(to: TimeOff) => (
                  <Button
                    icon="pi pi-ellipsis-v"
                    text
                    rounded
                    severity="secondary"
                    size="small"
                    onClick={(e) => {
                      setToMenuItems(buildTOMenuItems(to));
                      (toMenuRef.current as Menu | null)?.toggle(e);
                    }}
                  />
                )}
              />
            </DataTable>
          </>
        )}
      </div>

      {/* =============================================================== */}
      {/* Working Hour Create / Edit Modal */}
      {/* =============================================================== */}
      <WorkingHourFormModal
        key={editingWH?.id ?? 'create-wh'}
        open={creatingWH || editingWH !== null}
        title={editingWH ? t('res_whEditTitle') : t('res_whAddTitle')}
        initialValues={editingWH ?? undefined}
        dayOptions={dayOptions}
        serverError={(whMutation.error as ApiError | undefined)?.message ?? null}
        isSubmitting={whMutation.isPending}
        onClose={() => {
          setCreatingWH(false);
          setEditingWH(null);
        }}
        onSubmit={(values) => {
          whMutation.mutate({
            id: editingWH?.id,
            body: {
              dayOfWeek: values.dayOfWeek,
              startTime: values.startTime,
              endTime: values.endTime,
              validFrom: values.validFrom,
              validTo: clean(values.validTo),
            },
          });
        }}
      />

      {/* Working Hour Delete Confirmation */}
      <Modal
        open={deletingWH !== null}
        title={t('res_whDeleteTitle')}
        onClose={() => setDeletingWH(null)}
        size="sm"
        footer={
          <>
            <Button label={t('common_cancel')} outlined size="small" onClick={() => setDeletingWH(null)} />
            <Button
              label={deleteWHMutation.isPending ? t('common_loading') : t('res_actionDelete')}
              severity="danger"
              size="small"
              disabled={deleteWHMutation.isPending}
              onClick={() => {
                if (deletingWH) deleteWHMutation.mutate(deletingWH.id);
              }}
            />
          </>
        }
      >
        {(deleteWHMutation.error as ApiError | undefined)?.message && (
          <Message
            severity="error"
            text={(deleteWHMutation.error as ApiError).message}
            style={{ marginBottom: '0.75rem' }}
          />
        )}
        <p style={{ fontSize: '0.875rem', color: 'var(--text-color)' }}>{t('res_whDeleteBody')}</p>
      </Modal>

      {/* =============================================================== */}
      {/* Time Off Create Modal */}
      {/* =============================================================== */}
      <TimeOffFormModal
        key="create-to"
        open={creatingTO}
        title={t('res_toAddTitle')}
        serverError={(toMutation.error as ApiError | undefined)?.message ?? null}
        isSubmitting={toMutation.isPending}
        onClose={() => setCreatingTO(false)}
        onSubmit={(values) => {
          toMutation.mutate({
            startAt: new Date(values.startAt!).toISOString(),
            endAt: new Date(values.endAt!).toISOString(),
            reason: clean(values.reason),
          });
        }}
      />

      {/* Time Off Delete Confirmation */}
      <Modal
        open={deletingTO !== null}
        title={t('res_toDeleteTitle')}
        onClose={() => setDeletingTO(null)}
        size="sm"
        footer={
          <>
            <Button label={t('common_cancel')} outlined size="small" onClick={() => setDeletingTO(null)} />
            <Button
              label={deleteTOMutation.isPending ? t('common_loading') : t('res_actionDelete')}
              severity="danger"
              size="small"
              disabled={deleteTOMutation.isPending}
              onClick={() => {
                if (deletingTO) deleteTOMutation.mutate(deletingTO.id);
              }}
            />
          </>
        }
      >
        {(deleteTOMutation.error as ApiError | undefined)?.message && (
          <Message
            severity="error"
            text={(deleteTOMutation.error as ApiError).message}
            style={{ marginBottom: '0.75rem' }}
          />
        )}
        <p style={{ fontSize: '0.875rem', color: 'var(--text-color)' }}>{t('res_toDeleteBody')}</p>
      </Modal>
    </>
  );
}

// ---------------------------------------------------------------------------
// WorkingHourFormModal
// ---------------------------------------------------------------------------

function WorkingHourFormModal({
  open,
  title,
  initialValues,
  dayOptions,
  serverError,
  isSubmitting,
  onClose,
  onSubmit,
}: {
  open: boolean;
  title: string;
  initialValues?: WorkingHour;
  dayOptions: { label: string; value: number }[];
  serverError: string | null;
  isSubmitting: boolean;
  onClose: () => void;
  onSubmit: (values: WhFormValues) => void;
}) {
  const { t } = useI18n();

  const [values, setValues] = useState<WhFormValues>(
    initialValues
      ? {
          dayOfWeek: initialValues.dayOfWeek,
          startTime: initialValues.startTime.slice(0, 5),
          endTime: initialValues.endTime.slice(0, 5),
          validFrom: initialValues.validFrom,
          validTo: initialValues.validTo ?? '',
        }
      : {
          dayOfWeek: 0,
          startTime: '09:00',
          endTime: '17:00',
          validFrom: '',
          validTo: '',
        },
  );

  const [errors, setErrors] = useState<WhFormErrors>({});
  const [touched, setTouched] = useState<Record<string, boolean>>({});

  const handleChange = (field: keyof WhFormValues, val: string | number) => {
    setValues((prev) => ({ ...prev, [field]: val }));
    setTouched((prev) => ({ ...prev, [field]: true }));
    const updated = { ...values, [field]: val };
    const newErrors = validateWhForm(updated as WhFormValues);
    setErrors((prev) => ({ ...prev, [field]: newErrors[field as keyof WhFormErrors] }));
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const allTouched: Record<string, boolean> = {};
    (Object.keys(values) as (keyof WhFormValues)[]).forEach((k) => {
      allTouched[k] = true;
    });
    setTouched(allTouched);
    const validationErrors = validateWhForm(values);
    setErrors(validationErrors);
    if (Object.keys(validationErrors).length === 0) {
      onSubmit(values);
    }
  };

  const fieldError = (field: keyof WhFormErrors) => (touched[field] ? errors[field] : undefined);

  return (
    <Modal
      open={open}
      title={title}
      onClose={onClose}
      footer={
        <>
          <Button label={t('common_cancel')} outlined size="small" onClick={onClose} />
          <Button
            label={isSubmitting ? t('res_formSaving') : t('common_save')}
            size="small"
            disabled={isSubmitting}
            onClick={handleSubmit}
          />
        </>
      }
    >
      {serverError && (
        <Message severity="error" text={serverError} style={{ marginBottom: '1rem' }} />
      )}

      <form onSubmit={handleSubmit} noValidate>
        <Field label={t('res_whFieldDayOfWeek')} error={fieldError('dayOfWeek')}>
          <Dropdown
            style={{ width: '100%' }}
            value={values.dayOfWeek}
            options={dayOptions}
            onChange={(e) => handleChange('dayOfWeek', e.value)}
          />
        </Field>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: '1rem' }}>
          <Field label={t('res_whFieldStartTime')} error={fieldError('startTime')}>
            <InputText
              style={{ width: '100%' }}
              type="time"
              value={values.startTime}
              onChange={(e) => handleChange('startTime', e.target.value)}
            />
          </Field>
          <Field label={t('res_whFieldEndTime')} error={fieldError('endTime')}>
            <InputText
              style={{ width: '100%' }}
              type="time"
              value={values.endTime}
              onChange={(e) => handleChange('endTime', e.target.value)}
            />
          </Field>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: '1rem' }}>
          <Field label={t('res_whFieldValidFrom')} error={fieldError('validFrom')}>
            <Calendar
              style={{ width: '100%' }}
              value={values.validFrom ? new Date(values.validFrom) : null}
              onChange={(e) => {
                const d = e.value as Date | null;
                handleChange('validFrom', d ? d.toISOString().slice(0, 10) : '');
              }}
              dateFormat="yy-mm-dd"
              showIcon
            />
          </Field>
          <Field label={t('res_whFieldValidTo')} error={fieldError('validTo')}>
            <Calendar
              style={{ width: '100%' }}
              value={values.validTo ? new Date(values.validTo) : null}
              onChange={(e) => {
                const d = e.value as Date | null;
                handleChange('validTo', d ? d.toISOString().slice(0, 10) : '');
              }}
              dateFormat="yy-mm-dd"
              showIcon
            />
          </Field>
        </div>
      </form>
    </Modal>
  );
}

// ---------------------------------------------------------------------------
// TimeOffFormModal
// ---------------------------------------------------------------------------

function TimeOffFormModal({
  open,
  title,
  serverError,
  isSubmitting,
  onClose,
  onSubmit,
}: {
  open: boolean;
  title: string;
  serverError: string | null;
  isSubmitting: boolean;
  onClose: () => void;
  onSubmit: (values: ToFormValues) => void;
}) {
  const { t } = useI18n();

  const [values, setValues] = useState<ToFormValues>({
    startAt: null,
    endAt: null,
    reason: '',
  });

  const [errors, setErrors] = useState<ToFormErrors>({});
  const [touched, setTouched] = useState<Record<string, boolean>>({});

  const handleChange = (field: keyof ToFormValues, val: Date | null | string) => {
    setValues((prev) => ({ ...prev, [field]: val }));
    setTouched((prev) => ({ ...prev, [field]: true }));
    const updated = { ...values, [field]: val };
    const newErrors = validateToForm(updated as ToFormValues);
    setErrors((prev) => ({ ...prev, [field]: newErrors[field as keyof ToFormErrors] }));
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const allTouched: Record<string, boolean> = {};
    (Object.keys(values) as (keyof ToFormValues)[]).forEach((k) => {
      allTouched[k] = true;
    });
    setTouched(allTouched);
    const validationErrors = validateToForm(values);
    setErrors(validationErrors);
    if (Object.keys(validationErrors).length === 0) {
      onSubmit(values);
    }
  };

  const fieldError = (field: keyof ToFormErrors) => (touched[field] ? errors[field] : undefined);

  return (
    <Modal
      open={open}
      title={title}
      onClose={onClose}
      footer={
        <>
          <Button label={t('common_cancel')} outlined size="small" onClick={onClose} />
          <Button
            label={isSubmitting ? t('res_formSaving') : t('res_addBtn')}
            size="small"
            disabled={isSubmitting}
            onClick={handleSubmit}
          />
        </>
      }
    >
      {serverError && (
        <Message severity="error" text={serverError} style={{ marginBottom: '1rem' }} />
      )}

      <form onSubmit={handleSubmit} noValidate>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '1rem' }}>
          <Field label={t('res_toFieldStart')} error={fieldError('startAt')}>
            <Calendar
              style={{ width: '100%' }}
              value={values.startAt}
              onChange={(e) => handleChange('startAt', e.value as Date | null)}
              showTime
              showSeconds
              dateFormat="yy-mm-dd"
              showIcon
              placeholder={t('res_toFieldStart')}
            />
          </Field>
          <Field label={t('res_toFieldEnd')} error={fieldError('endAt')}>
            <Calendar
              style={{ width: '100%' }}
              value={values.endAt}
              onChange={(e) => handleChange('endAt', e.value as Date | null)}
              showTime
              showSeconds
              dateFormat="yy-mm-dd"
              showIcon
              placeholder={t('res_toFieldEnd')}
            />
          </Field>
        </div>
        <Field label={t('res_toFieldReason')} error={fieldError('reason')}>
          <InputText
            style={{ width: '100%' }}
            maxLength={200}
            placeholder={t('res_toFieldReasonPlaceholder')}
            value={values.reason}
            onChange={(e) => handleChange('reason', e.target.value)}
          />
        </Field>
      </form>
    </Modal>
  );
}
