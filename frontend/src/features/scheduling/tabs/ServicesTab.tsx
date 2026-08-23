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

import { api, ApiError } from '../../../lib/api';
import { Modal } from '../../../components/Modal';
import { Spinner } from '../../../components/Spinner';
import { EmptyState } from '../../../components/EmptyState';
import { getResourceTypeLabels } from '../../calendar/lifecycle';
import { useI18n } from '../../../lib/i18n';

import type { ResourceType, Service, ServiceResourceRequirement } from '../../../lib/types';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface RequirementRow {
  resourceType: ResourceType;
  quantity: number;
  isRequired: boolean;
}

interface FormValues {
  name: string;
  description: string;
  category: string;
  durationMinutes: string;
  bufferBeforeMinutes: string;
  bufferAfterMinutes: string;
  price: string;
  isActive: boolean;
}

interface FormErrors {
  name?: string;
  description?: string;
  category?: string;
  durationMinutes?: string;
  bufferBeforeMinutes?: string;
  bufferAfterMinutes?: string;
  price?: string;
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
  if (!values.name.trim()) errors.name = 'Required';
  else if (values.name.length > 120) errors.name = 'Max 120 characters';
  if (values.description.length > 5000) errors.description = 'Max 5000 characters';
  if (values.category.length > 80) errors.category = 'Max 80 characters';
  const dur = Number(values.durationMinutes);
  if (!values.durationMinutes.trim()) errors.durationMinutes = 'Required';
  else if (!Number.isInteger(dur) || dur <= 0) errors.durationMinutes = 'Must be > 0';
  const bb = Number(values.bufferBeforeMinutes);
  if (values.bufferBeforeMinutes.trim() !== '' && (!Number.isInteger(bb) || bb < 0))
    errors.bufferBeforeMinutes = 'Must be >= 0';
  const ba = Number(values.bufferAfterMinutes);
  if (values.bufferAfterMinutes.trim() !== '' && (!Number.isInteger(ba) || ba < 0))
    errors.bufferAfterMinutes = 'Must be >= 0';
  if (values.price.trim() !== '' && isNaN(Number(values.price)))
    errors.price = 'Invalid number';
  else if (values.price.trim() !== '' && Number(values.price) < 0)
    errors.price = 'Must be >= 0';
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
// ServicesTab
// ---------------------------------------------------------------------------

export const ServicesTab = forwardRef(function ServicesTab(_props, ref) {
  const { t } = useI18n();

  // --- State ---
  const [creating, setCreating] = useState(false);

  useImperativeHandle(ref, () => ({ openCreate: () => setCreating(true) }), []);
  const [editing, setEditing] = useState<Service | null>(null);
  const [deleting, setDeleting] = useState<Service | null>(null);
  const [requirementsService, setRequirementsService] = useState<Service | null>(null);
  const menuRef = useRef<Menu>(null);
  const [menuItems, setMenuItems] = useState<MenuItem[]>([]);

  const queryClient = useQueryClient();

  // --- Queries ---
  const {
    data,
    isLoading,
  } = useQuery({
    queryKey: ['services'],
    queryFn: () => api.listServices(),
  });

  const services = data?.services ?? [];

  // --- Mutations ---
  const createMutation = useMutation({
    mutationFn: (body: Parameters<typeof api.createService>[0]) => api.createService(body),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['services'] });
      setCreating(false);
    },
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, body }: { id: string; body: Parameters<typeof api.updateService>[1] }) =>
      api.updateService(id, body),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['services'] });
      setEditing(null);
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => api.deleteService(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['services'] });
      setDeleting(null);
    },
  });

  // --- Menu items for row actions ---
  const buildMenuItems = (service: Service) => [
    {
      label: t('svc_actionEdit'),
      icon: 'pi pi-pencil',
      command: () => setEditing(service),
    },
    {
      label: t('svc_actionRequirements'),
      icon: 'pi pi-list',
      command: () => setRequirementsService(service),
    },
    { separator: true },
    {
      label: t('svc_actionDelete'),
      icon: 'pi pi-trash',
      command: () => setDeleting(service),
    },
  ];

  // ---------------------------------------------------------------------------
  // Requirements Panel
  // ---------------------------------------------------------------------------

  if (requirementsService) {
    return <RequirementsPanel service={requirementsService} onBack={() => setRequirementsService(null)} />;
  }

  // ---------------------------------------------------------------------------
  // Main page
  // ---------------------------------------------------------------------------

  const formServerError =
    (createMutation.error as ApiError | undefined) ??
    (updateMutation.error as ApiError | undefined) ??
    null;
  const formServerMsg = formServerError?.message ?? null;

  const deleteServerError = deleteMutation.error as ApiError | undefined;
  const deleteServerMsg = deleteServerError?.message ?? null;

  return (
    <>
      {/* Loading / Error */}
      {isLoading ? (
        <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', padding: '5rem 1rem' }}>
          <Spinner />
        </div>
      ) : services.length === 0 ? (
        <EmptyState>{t('svc_noServices')}</EmptyState>
      ) : (
        /* Services Table */
        <>
          <Menu
            ref={menuRef}
            model={menuItems}
            popup
            id="services_action_menu"
          />
          <DataTable
            value={services}
            dataKey="id"
            rowHover
            paginator
            rows={10}
            removableSort
            sortMode="multiple"
            emptyMessage={t('svc_noServices')}
            style={{ background: 'var(--surface-card)' }}
          >
            <Column
              field="name"
              header={t('svc_colName')}
              sortable
              body={(s: Service) => (
                <span style={{ fontWeight: 500 }}>{s.name}</span>
              )}
            />
            <Column
              field="category"
              header={t('svc_colCategory')}
              sortable
              body={(s: Service) => s.category || '\u2014'}
            />
            <Column
              field="durationMinutes"
              header={t('svc_colDuration')}
              sortable
              body={(s: Service) => t('svc_durationMin', { min: String(s.durationMinutes) })}
            />
            <Column
              field="buffers"
              header={t('svc_colBuffers')}
              body={(s: Service) =>
                s.bufferBeforeMinutes > 0 || s.bufferAfterMinutes > 0
                  ? t('svc_bufferBeforeAfter', {
                      before: String(s.bufferBeforeMinutes),
                      after: String(s.bufferAfterMinutes),
                    })
                  : '\u2014'
              }
            />
            <Column
              field="price"
              header={t('svc_colPrice')}
              sortable
              body={(s: Service) =>
                s.price != null
                  ? `${s.price.toLocaleString('ro-RO', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} lei`
                  : '\u2014'
              }
            />
            <Column
              field="isActive"
              header={t('svc_colStatus')}
              sortable
              body={(s: Service) => (
                <Badge
                  value={s.isActive ? t('svc_statusActive') : t('svc_statusInactive')}
                  severity={s.isActive ? 'success' : 'warning'}
                />
              )}
            />
            <Column
              header=""
              style={{ width: '3rem', textAlign: 'center' }}
              body={(s: Service) => (
                <Button
                  icon="pi pi-ellipsis-v"
                  rounded
                  severity="secondary"
                  size="small"
                  onClick={(e) => {
                    setMenuItems(buildMenuItems(s));
                    (menuRef.current as Menu | null)?.toggle(e);
                  }}
                />
              )}
            />
          </DataTable>
        </>
      )}

      {/* ----------------------------------------------------------------- */}
      {/* Create / Edit Service Modal */}
      {/* ----------------------------------------------------------------- */}
      <ServiceFormModal
        key={editing?.id ?? 'create'}
        open={creating || editing !== null}
        title={editing ? t('svc_formEditTitle') : t('svc_formAddTitle')}
        initialValues={editing ?? undefined}
        serverError={formServerMsg}
        isSubmitting={createMutation.isPending || updateMutation.isPending}
        onClose={() => {
          setCreating(false);
          setEditing(null);
        }}
        onSubmit={(values) => {
          const payload = {
            name: values.name,
            description: clean(values.description),
            category: clean(values.category),
            durationMinutes: Number(values.durationMinutes),
            bufferBeforeMinutes: Number(values.bufferBeforeMinutes) || 0,
            bufferAfterMinutes: Number(values.bufferAfterMinutes) || 0,
            ...(values.price !== '' && values.price.trim() !== '' ? { price: Number(values.price) } : {}),
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
        title={t('svc_deleteTitle')}
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
              label={deleteMutation.isPending ? t('common_loading') : t('svc_actionDelete')}
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
          <Message
            severity="error"
            text={deleteServerMsg}
            style={{ marginBottom: '0.75rem' }}
          />
        )}
        <p style={{ fontSize: '0.875rem', color: 'var(--text-color)' }}>
          {t('svc_deleteBody', { name: deleting?.name ?? '' })}
        </p>
      </Modal>
    </>
  );
})

// ---------------------------------------------------------------------------
// ServiceFormModal
// ---------------------------------------------------------------------------

function ServiceFormModal({
  open,
  title,
  initialValues,
  serverError,
  isSubmitting,
  onClose,
  onSubmit,
}: {
  open: boolean;
  title: string;
  initialValues?: Service;
  serverError: string | null;
  isSubmitting: boolean;
  onClose: () => void;
  onSubmit: (values: FormValues) => void;
}) {
  const { t } = useI18n();

  const [values, setValues] = useState<FormValues>(
    initialValues
      ? {
          name: initialValues.name,
          description: initialValues.description ?? '',
          category: initialValues.category ?? '',
          durationMinutes: String(initialValues.durationMinutes),
          bufferBeforeMinutes: String(initialValues.bufferBeforeMinutes),
          bufferAfterMinutes: String(initialValues.bufferAfterMinutes),
          price: initialValues.price != null ? String(initialValues.price) : '',
          isActive: initialValues.isActive,
        }
      : {
          name: '',
          description: '',
          category: '',
          durationMinutes: '',
          bufferBeforeMinutes: '0',
          bufferAfterMinutes: '0',
          price: '',
          isActive: true,
        },
  );

  const [errors, setErrors] = useState<FormErrors>({});
  const [touched, setTouched] = useState<Record<string, boolean>>({});

  const handleChange = (field: keyof FormValues, val: string | boolean) => {
    setValues((prev) => ({ ...prev, [field]: val }));
    setTouched((prev) => ({ ...prev, [field]: true }));
    if (typeof val === 'string' || field === 'isActive') {
      const updated = { ...values, [field]: val };
      const newErrors = validateForm(updated);
      setErrors((prev) => ({ ...prev, [field]: newErrors[field as keyof FormErrors] }));
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const allTouched: Record<string, boolean> = {};
    (Object.keys(values) as (keyof FormValues)[]).forEach((k) => {
      allTouched[k] = true;
    });
    setTouched(allTouched);
    const validationErrors = validateForm(values);
    setErrors(validationErrors);
    if (Object.keys(validationErrors).length === 0) {
      onSubmit(values);
    }
  };

  const fieldError = (field: keyof FormErrors) => (touched[field] ? errors[field] : undefined);

  return (
    <Modal
      open={open}
      title={title}
      onClose={onClose}
      footer={
        <>
          <Button
            label={t('common_cancel')}
            outlined
            size="small"
            onClick={onClose}
          />
          <Button
            label={isSubmitting ? t('common_loading') : t('common_save')}
            size="small"
            disabled={isSubmitting}
            onClick={handleSubmit}
          />
        </>
      }
    >
      {serverError && (
        <Message
          severity="error"
          text={serverError}
          style={{ marginBottom: '1rem' }}
        />
      )}

      <form onSubmit={handleSubmit} noValidate>
        <Field label={t('svc_fieldName')} error={fieldError('name')}>
          <InputText
            style={{ width: '100%' }}
            maxLength={120}
            value={values.name}
            onChange={(e) => handleChange('name', e.target.value)}
          />
        </Field>

        <Field label={t('svc_fieldDescription')} error={fieldError('description')}>
          <InputTextarea
            style={{ width: '100%' }}
            rows={3}
            maxLength={5000}
            value={values.description}
            onChange={(e) => handleChange('description', e.target.value)}
          />
        </Field>

        <Field label={t('svc_fieldCategory')} error={fieldError('category')}>
          <InputText
            style={{ width: '100%' }}
            maxLength={80}
            placeholder={t('svc_fieldCategoryPlaceholder')}
            value={values.category}
            onChange={(e) => handleChange('category', e.target.value)}
          />
        </Field>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: '1rem' }}>
          <Field label={t('svc_fieldDuration')} error={fieldError('durationMinutes')}>
            <InputText
              style={{ width: '100%' }}
              type="number"
              min={1}
              step={1}
              value={values.durationMinutes}
              onChange={(e) => handleChange('durationMinutes', e.target.value)}
            />
          </Field>

          <Field label={t('svc_fieldBufferBefore')} error={fieldError('bufferBeforeMinutes')}>
            <InputText
              style={{ width: '100%' }}
              type="number"
              min={0}
              step={1}
              value={values.bufferBeforeMinutes}
              onChange={(e) => handleChange('bufferBeforeMinutes', e.target.value)}
            />
          </Field>

          <Field label={t('svc_fieldBufferAfter')} error={fieldError('bufferAfterMinutes')}>
            <InputText
              style={{ width: '100%' }}
              type="number"
              min={0}
              step={1}
              value={values.bufferAfterMinutes}
              onChange={(e) => handleChange('bufferAfterMinutes', e.target.value)}
            />
          </Field>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: '1rem' }}>
          <Field label={t('svc_fieldPrice')} error={fieldError('price')}>
            <InputText
              style={{ width: '100%' }}
              type="number"
              min={0}
              step={0.01}
              placeholder="0.00"
              value={values.price}
              onChange={(e) => handleChange('price', e.target.value)}
            />
          </Field>
        </div>

        {/* isActive -- only shown when editing */}
        {initialValues && (
          <Field label={t('svc_fieldStatus')}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              <InputSwitch
                checked={values.isActive}
                onChange={(e) => handleChange('isActive', e.value ?? false)}
              />
              <span style={{ fontSize: '0.875rem', color: 'var(--text-color)' }}>
                {values.isActive ? t('svc_statusActive') : t('svc_statusInactive')}
              </span>
            </div>
          </Field>
        )}
      </form>
    </Modal>
  );
}

// ---------------------------------------------------------------------------
// RequirementsPanel
// ---------------------------------------------------------------------------

function RequirementsPanel({
  service,
  onBack,
}: {
  service: Service;
  onBack: () => void;
}) {
  const { t } = useI18n();
  const resourceTypeLabels = getResourceTypeLabels(t);
  const queryClient = useQueryClient();

  const {
    data: reqData,
    isLoading: reqLoading,
    isError: reqError,
  } = useQuery({
    queryKey: ['requirements', service.id],
    queryFn: () => api.listRequirements(service.id),
  });

  const existing: ServiceResourceRequirement[] = reqData?.requirements ?? [];

  const [rows, setRows] = useState<RequirementRow[]>(() =>
    existing.map((r) => ({
      resourceType: r.resourceType,
      quantity: r.quantity,
      isRequired: r.isRequired,
    })),
  );

  // Sync rows when query data changes (e.g. after save invalidation)
  const [saved, setSaved] = useState(false);

  const saveMutation = useMutation({
    mutationFn: (payload: RequirementRow[]) =>
      api.replaceRequirements(service.id, payload),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['requirements', service.id] });
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    },
  });

  const handleAddRow = () => {
    setRows((prev) => [
      ...prev,
      { resourceType: 'provider', quantity: 1, isRequired: true },
    ]);
  };

  const handleRemoveRow = (index: number) => {
    setRows((prev) => prev.filter((_, i) => i !== index));
  };

  const handleRowChange = <K extends keyof RequirementRow>(
    index: number,
    field: K,
    value: RequirementRow[K],
  ) => {
    setRows((prev) =>
      prev.map((row, i) => (i === index ? { ...row, [field]: value } : row)),
    );
  };

  const handleSave = () => {
    saveMutation.mutate(rows);
  };

  const saveError = saveMutation.error as ApiError | undefined;

  const resourceTypeOptions = (Object.keys(resourceTypeLabels) as ResourceType[]).map((rt) => ({
    label: resourceTypeLabels[rt],
    value: rt,
  }));

  return (
    <>
      <div style={{ marginBottom: '1rem' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div>
            <h2 style={{ fontSize: '1.125rem', fontWeight: 600, margin: 0, color: 'var(--text-color)' }}>
              {service.name}
            </h2>
            <p style={{ fontSize: '0.75rem', color: 'var(--text-color-secondary)', margin: '0.25rem 0 0 0' }}>
              {t('svc_reqTitle')}
            </p>
          </div>
          <Button
            label={t('svc_backToServices')}
            icon="pi pi-arrow-left"
            outlined
            size="small"
            onClick={onBack}
          />
        </div>
      </div>

      {saveError && (
        <Message
          severity="error"
          text={saveError.message ?? t('svc_reqErrorSave')}
          style={{ marginBottom: '0.75rem' }}
        />
      )}

      {saved && (
        <Message
          severity="success"
          text={t('svc_reqSaved')}
          style={{ marginBottom: '0.75rem' }}
        />
      )}

      {reqLoading ? (
        <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', padding: '5rem 1rem' }}>
          <Spinner />
        </div>
      ) : reqError ? (
        <EmptyState>{t('svc_reqErrorLoad')}</EmptyState>
      ) : rows.length === 0 ? (
        <EmptyState>{t('svc_reqNoRequirements')}</EmptyState>
      ) : (
        <DataTable
          value={rows}
          dataKey={(row) => String(rows.indexOf(row))}
          rowHover
          paginator={false}
          style={{ background: 'var(--surface-card)' }}
        >
          <Column
            header={t('svc_reqColResourceType')}
            body={(row: RequirementRow, { rowIndex }: { rowIndex: number }) => (
              <Dropdown
                style={{ width: '100%' }}
                value={row.resourceType}
                options={resourceTypeOptions}
                onChange={(e) => handleRowChange(rowIndex, 'resourceType', e.value)}
              />
            )}
          />
          <Column
            header={t('svc_reqColQuantity')}
            body={(row: RequirementRow, { rowIndex }: { rowIndex: number }) => (
              <InputText
                style={{ width: '5rem' }}
                type="number"
                min={1}
                step={1}
                value={String(row.quantity)}
                onChange={(e) =>
                  handleRowChange(rowIndex, 'quantity', Math.max(1, Number(e.target.value) || 1))
                }
              />
            )}
          />
          <Column
            header={t('svc_reqColRequired')}
            body={(row: RequirementRow, { rowIndex }: { rowIndex: number }) => (
              <div style={{ display: 'flex', alignItems: 'center' }}>
                <InputSwitch
                  checked={row.isRequired}
                  onChange={(e) => handleRowChange(rowIndex, 'isRequired', e.value ?? false)}
                />
              </div>
            )}
          />
          <Column
            header=""
            style={{ width: '3rem', textAlign: 'center' }}
            body={(_row: RequirementRow, { rowIndex }: { rowIndex: number }) => (
              <Button
                icon="pi pi-times"
                text
                rounded
                severity="secondary"
                size="small"
                onClick={() => handleRemoveRow(rowIndex)}
                title={t('common_cancel')}
              />
            )}
          />
        </DataTable>
      )}

      {/* Action bar */}
      <div style={{ marginTop: '1rem', display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
        <Button
          label={t('svc_reqAddButton')}
          icon="pi pi-plus"
          outlined
          size="small"
          onClick={handleAddRow}
        />
        {rows.length > 0 && (
          <Button
            label={saveMutation.isPending ? t('svc_reqSaving') : t('svc_reqSaveButton')}
            icon="pi pi-check"
            size="small"
            disabled={saveMutation.isPending}
            onClick={handleSave}
          />
        )}
      </div>
    </>
  );
}
