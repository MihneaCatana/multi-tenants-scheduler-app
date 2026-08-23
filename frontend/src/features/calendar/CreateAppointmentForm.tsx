import { useState, useMemo, useEffect, useRef } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { format } from 'date-fns';
import { Button } from 'primereact/button';
import { InputText } from 'primereact/inputtext';
import { InputTextarea } from 'primereact/inputtextarea';
import { InputSwitch } from 'primereact/inputswitch';
import { Dropdown } from 'primereact/dropdown';
import { Calendar } from 'primereact/calendar';
import { Message } from 'primereact/message';
import { api, ApiError } from '../../lib/api';
import { Modal } from '../../components/Modal';
import { Spinner } from '../../components/Spinner';
import { useI18n } from '../../lib/i18n';

/**
 * Create-appointment form (Phase 1).
 *
 * Lets staff pick a client (optional — walk-ins allowed), resource, service, and
 * start time to create a booking. Surfaces 409 conflict errors inline on the
 * startAt field. Multi-resource selection is deferred to Phase 2 (primary
 * resource only at create).
 *
 * Render it behind the APPOINTMENTS feature flag, inside the AppointmentsWorkspace.
 */

interface FormValues {
  clientId: string;
  resourceId: string;
  serviceIds: string[];
  durationMinutes: string;
  startAt: string;
  summary: string;
  notes: string;
}

interface FormErrors {
  root?: string;
  resourceId?: string;
  serviceIds?: string;
  startAt?: string;
  durationMinutes?: string;
}

interface Props {
  open: boolean;
  onClose: () => void;
  /** Pre-fill the start-at field (ISO string or datetime-local formatted string). */
  defaultStartAt?: string;
}

function validate(values: FormValues): FormErrors {
  const errors: FormErrors = {};
  if (!values.resourceId) {
    errors.resourceId = 'Select a resource';
  }
  if (!values.startAt || !new Date(values.startAt).getTime()) {
    errors.startAt = 'Pick a start time';
  }
  if (!values.durationMinutes) {
    errors.durationMinutes = 'Set a duration';
  } else {
    const n = Number(values.durationMinutes);
    if (!Number.isInteger(n) || n <= 0) {
      errors.durationMinutes = 'Must be a positive integer';
    }
  }
  if (values.summary && values.summary.length > 200) {
    errors.root = 'Summary max 200 characters';
  }
  if (values.notes && values.notes.length > 5000) {
    errors.root = 'Notes max 5000 characters';
  }
  return errors;
}

/* ---- Collapsible section helper ---------------------------------------- */

function CollapsibleSection({
  open: isOpen,
  onToggle,
  label,
  count,
  children,
}: {
  open: boolean;
  onToggle: () => void;
  label: string;
  count?: number;
  children: React.ReactNode;
}) {
  return (
    <div>
      <button
        type="button"
        onClick={onToggle}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: '0.375rem',
          fontSize: '0.875rem',
          fontWeight: 500,
          color: 'var(--text-color)',
          background: 'none',
          border: 'none',
          cursor: 'pointer',
          padding: 0,
          width: '100%',
          textAlign: 'left',
        }}
      >
        <i
          className="pi pi-chevron-right"
          style={{
            fontSize: '0.75rem',
            transition: 'transform 0.2s',
            transform: isOpen ? 'rotate(90deg)' : 'rotate(0deg)',
          }}
        />
        {label}
        {count !== undefined && count > 0 && (
          <span style={{ fontSize: '0.75rem', color: 'var(--text-color-secondary)' }}>({count})</span>
        )}
      </button>
      {isOpen && <div style={{ marginTop: '0.5rem' }}>{children}</div>}
    </div>
  );
}

export function CreateAppointmentForm({ open, onClose, defaultStartAt }: Props) {
  const { t } = useI18n();
  const qc = useQueryClient();
  const { data: providersData, isLoading: loadingProviders } = useQuery({
    queryKey: ['resources', 'provider'],
    queryFn: () => api.listResources({ type: 'provider' }),
    enabled: open,
  });
  const { data: roomsData, isLoading: loadingRooms } = useQuery({
    queryKey: ['resources', 'room'],
    queryFn: () => api.listResources({ type: 'room' }),
    enabled: open,
  });
  const { data: resourcesData } = useQuery({
    queryKey: ['resources', 'extras'],
    queryFn: () => api.listResources(),
    enabled: open,
  });
  const { data: servicesData } = useQuery({
    queryKey: ['services'],
    queryFn: () => api.listServices(),
    enabled: open,
  });
  const { data: clientsData, isLoading: loadingClients } = useQuery({
    queryKey: ['clients'],
    queryFn: () => api.listClients(),
    enabled: open,
  });

  const [values, setValues] = useState<FormValues>({
    clientId: '',
    resourceId: '',
    serviceIds: [],
    durationMinutes: '',
    startAt: '',
    summary: '',
    notes: '',
  });
  const [errors, setErrors] = useState<FormErrors>({});

  const set = <K extends keyof FormValues>(key: K, val: FormValues[K]) =>
    setValues((prev) => ({ ...prev, [key]: val }));

  // Pre-fill startAt when the modal opens with a default from the calendar
  useEffect(() => {
    if (open && defaultStartAt) {
      const d = new Date(defaultStartAt);
      if (!isNaN(d.getTime())) {
        const pad = (n: number) => String(n).padStart(2, '0');
        const local = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
        set('startAt', local);
      }
    }
  }, [open, defaultStartAt]);

  // Compute additional resources list (equipment/chair only)
  const additionalResources = useMemo(
    () => (resourcesData?.resources ?? []).filter((r) => r.type === 'equipment' || r.type === 'chair'),
    [resourcesData?.resources],
  );

  const [additionalIds, setAdditionalIds] = useState<string[]>([]);
  const [selectedRoomId, setSelectedRoomId] = useState<string>('');
  const [showResources, setShowResources] = useState(false);
  const [showServices, setShowServices] = useState(false);
  const [showOptional, setShowOptional] = useState(false);

  // Compute end-time preview when services are selected and a start time is provided
  const selectedServices = useMemo(() => {
    if (!values.serviceIds || values.serviceIds.length === 0) return null;
    return (servicesData?.services ?? []).filter((s) => values.serviceIds.includes(s.id));
  }, [servicesData?.services, values.serviceIds]);

  const endAtPreview = useMemo(() => {
    if (!values.startAt) return null;
    const dur = values.durationMinutes ? Number(values.durationMinutes) : null;
    if (!dur) return null;
    const end = new Date(new Date(values.startAt).getTime() + dur * 60 * 1000);
    return format(end, 'HH:mm');
  }, [values.startAt, values.durationMinutes]);

  // Auto-fill durationMinutes when services are selected/changed
  useEffect(() => {
    if (selectedServices && selectedServices.length > 0) {
      const total = selectedServices.reduce(
        (sum, s) => sum + s.durationMinutes + s.bufferBeforeMinutes + s.bufferAfterMinutes,
        0,
      );
      set('durationMinutes', String(total));
    }
  }, [selectedServices]);

  const formRef = useRef<HTMLFormElement>(null);

  const mutation = useMutation({
    mutationFn: () => {
      const v = values;
      return api.createAppointment({
        clientId: v.clientId || undefined,
        resourceId: v.resourceId,
        serviceIds: v.serviceIds.length > 0 ? v.serviceIds : undefined,
        durationMinutes: v.durationMinutes ? Number(v.durationMinutes) : undefined,
        additionalResourceIds: (() => {
          const ids = [...additionalIds];
          if (selectedRoomId) ids.push(selectedRoomId);
          return ids.length > 0 ? ids : undefined;
        })(),
        startAt: new Date(v.startAt).toISOString(),
        summary: v.summary || undefined,
        notes: v.notes || undefined,
      });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['appointments'] });
      setValues({ clientId: '', resourceId: '', serviceIds: [], durationMinutes: '', startAt: '', summary: '', notes: '' });
      setAdditionalIds([]);
      setSelectedRoomId('');
      setShowResources(false);
      setShowOptional(false);
      setErrors({});
      onClose();
    },
    onError: (err: unknown) => {
      // Surface the conflict message inline on the startAt field.
      if (err instanceof ApiError && err.status === 409) {
        setErrors((prev) => ({ ...prev, startAt: err.message }));
      } else if (err instanceof ApiError) {
        setErrors((prev) => ({ ...prev, root: err.message }));
      }
    },
  });

  const onSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const validationErrors = validate(values);
    setErrors(validationErrors);
    if (Object.keys(validationErrors).length > 0) return;
    mutation.mutate();
  };

  if (!open) return null;

  /* ---- Dropdown option builders -------------------------------------- */
  const clientOptions = [
    { label: t('apptCreate_walkInOption'), value: '' },
    ...(clientsData?.clients ?? []).map((c) => ({
      label: c.name + (c.email ? ` (${c.email})` : ''),
      value: c.id,
    })),
  ];

  const providerOptions = (providersData?.resources ?? []).map((r) => ({
    label: r.name,
    value: r.id,
  }));

  const roomOptions = [
    { label: t('apptCreate_noRoom'), value: '' },
    ...(roomsData?.resources ?? []).map((r) => ({
      label: r.name,
      value: r.id,
    })),
  ];

  /* ---- Date helper for startAt --------------------------------------- */
  let startAtDate: Date | undefined;
  if (values.startAt) {
    const d = new Date(values.startAt);
    if (!isNaN(d.getTime())) startAtDate = d;
  }

  return (
    <Modal
      open={open}
      title={t('apptCreate_title')}
      onClose={onClose}
      footer={
        <>
          <Button type="button" label={t('common_cancel')} severity="secondary" outlined onClick={onClose} />
          <Button type="button" label={mutation.isPending ? t('apptCreate_creating') : t('apptCreate_create')} disabled={mutation.isPending} onClick={onSubmit} />
        </>
      }
    >
      <form
        ref={formRef}
        onSubmit={onSubmit}
        style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}
      >
        {errors.root && (
          <Message severity="error" text={errors.root} />
        )}

        {/* Client */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
          <label style={{ fontSize: '0.875rem', fontWeight: 500 }}>{t('apptCreate_clientLabel')}</label>
          {loadingClients ? (
            <Spinner />
          ) : (
            <Dropdown
              value={values.clientId}
              options={clientOptions}
              onChange={(e) => set('clientId', e.value ?? '')}
              placeholder={t('apptCreate_walkInOption')}
            />
          )}
        </div>

        {/* Provider (required) */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
          <label style={{ fontSize: '0.875rem', fontWeight: 500 }}>{t('apptCreate_providerLabel')}</label>
          {loadingProviders ? (
            <Spinner />
          ) : (
            <Dropdown
              value={values.resourceId}
              options={providerOptions}
              onChange={(e) => { set('resourceId', e.value ?? ''); setErrors((prev) => ({ ...prev, resourceId: undefined })); }}
              placeholder={t('apptCreate_selectPlaceholder')}
            />
          )}
          {errors.resourceId && (
            <small className="field-error" style={{ color: 'var(--red-500)', fontSize: '0.75rem' }}>{errors.resourceId}</small>
          )}
        </div>

        {/* Room (optional) */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
          <label style={{ fontSize: '0.875rem', fontWeight: 500 }}>{t('apptCreate_roomLabel')}</label>
          {loadingRooms ? (
            <Spinner />
          ) : (
            <Dropdown
              value={selectedRoomId}
              options={roomOptions}
              onChange={(e) => setSelectedRoomId(e.value ?? '')}
              placeholder={t('apptCreate_selectPlaceholder')}
            />
          )}
        </div>

        {/* Services — collapsible multi-select */}
        <CollapsibleSection
          open={showServices}
          onToggle={() => setShowServices(!showServices)}
          label={t('apptCreate_serviceLabel')}
          count={values.serviceIds.length}
        >
          <div
            style={{
              border: '1px solid var(--surface-border)',
              borderRadius: '0.25rem',
              padding: '0.5rem',
              maxHeight: '8rem',
              overflowY: 'auto',
              display: 'flex',
              flexDirection: 'column',
              gap: '0.25rem',
            }}
          >
            {(servicesData?.services ?? []).map((s) => {
              const checked = values.serviceIds.includes(s.id);
              return (
                <label
                  key={s.id}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    fontSize: '0.875rem',
                    cursor: 'pointer',
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                    <InputSwitch
                      checked={checked}
                      onChange={(e) => {
                        const next = e.value
                          ? [...values.serviceIds, s.id]
                          : values.serviceIds.filter((x) => x !== s.id);
                        set('serviceIds', next);
                      }}
                    />
                    {s.name}
                  </div>
                  <span style={{ fontSize: '0.75rem', color: 'var(--text-color-secondary)' }}>{s.durationMinutes}m</span>
                </label>
              );
            })}
          </div>
          {errors.serviceIds && (
            <small className="field-error" style={{ color: 'var(--red-500)', fontSize: '0.75rem', marginTop: '0.25rem' }}>{errors.serviceIds}</small>
          )}
        </CollapsibleSection>

        {/* Start at — DatePicker with time */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
          <label style={{ fontSize: '0.875rem', fontWeight: 500 }}>{t('apptCreate_startAtLabel')}</label>
          <Calendar
            value={startAtDate}
            onChange={(e) => {
              if (e.value) {
                const d = e.value as Date;
                const pad = (n: number) => String(n).padStart(2, '0');
                const local = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
                set('startAt', local);
                setErrors((prev) => ({ ...prev, startAt: undefined }));
              }
            }}
            showTime
            hourFormat="24"
            showIcon
          />
          {errors.startAt && (
            <small className="field-error" style={{ color: 'var(--red-500)', fontSize: '0.75rem' }}>{errors.startAt}</small>
          )}

          {/* End-time preview */}
          {endAtPreview && selectedServices && selectedServices.length > 0 && (
            <p style={{ fontSize: '0.75rem', color: 'var(--text-color-secondary)', margin: 0 }}>
              {t('apptCreate_endPreview', {
                time: endAtPreview,
                duration: String(selectedServices.reduce((sum, s) => sum + s.durationMinutes, 0)),
                buffer: String(
                  (selectedServices[0]?.bufferBeforeMinutes ?? 0) > 0
                    ? `${selectedServices[0]!.bufferBeforeMinutes}${(selectedServices[selectedServices.length - 1]?.bufferAfterMinutes ?? 0) > 0 ? `/${selectedServices[selectedServices.length - 1]!.bufferAfterMinutes}` : ''}`
                    : `${selectedServices[selectedServices.length - 1]?.bufferAfterMinutes ?? 0}`,
                ),
              })}
            </p>
          )}
        </div>

        {/* Duration */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
          <label style={{ fontSize: '0.875rem', fontWeight: 500 }}>{t('apptCreate_durationLabel')}</label>
          <InputText
            type="number"
            min={1}
            step={1}
            value={values.durationMinutes}
            onChange={(e) => set('durationMinutes', e.target.value)}
          />
          {errors.durationMinutes && (
            <small className="field-error" style={{ color: 'var(--red-500)', fontSize: '0.75rem' }}>{errors.durationMinutes}</small>
          )}
        </div>

        {/* Additional resources — collapsible */}
        {additionalResources.length > 0 && (
          <CollapsibleSection
            open={showResources}
            onToggle={() => setShowResources(!showResources)}
            label={t('apptCreate_additionalResourcesLabel')}
            count={additionalIds.length}
          >
            <div
              style={{
                border: '1px solid var(--surface-border)',
                borderRadius: '0.25rem',
                padding: '0.5rem',
                maxHeight: '8rem',
                overflowY: 'auto',
                display: 'flex',
                flexDirection: 'column',
                gap: '0.25rem',
              }}
            >
              {additionalResources.map((r) => {
                const checked = additionalIds.includes(r.id);
                return (
                  <label
                    key={r.id}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: '0.5rem',
                      fontSize: '0.875rem',
                      cursor: 'pointer',
                    }}
                  >
                    <InputSwitch
                      checked={checked}
                      onChange={(e) => {
                        setAdditionalIds((prev) =>
                          e.value
                            ? [...prev, r.id]
                            : prev.filter((x) => x !== r.id),
                        );
                      }}
                    />
                    {r.name} ({r.type})
                  </label>
                );
              })}
            </div>
          </CollapsibleSection>
        )}

        {/* Optional details — collapsible */}
        <CollapsibleSection
          open={showOptional}
          onToggle={() => setShowOptional(!showOptional)}
          label={t('apptCreate_optionalDetails')}
        >
          <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
            {/* Summary */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
              <label style={{ fontSize: '0.875rem', fontWeight: 500 }}>{t('apptCreate_summaryLabel')}</label>
              <InputText
                value={values.summary}
                onChange={(e) => set('summary', e.target.value)}
              />
            </div>

            {/* Notes */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
              <label style={{ fontSize: '0.875rem', fontWeight: 500 }}>{t('apptCreate_notesLabel')}</label>
              <InputTextarea
                rows={2}
                value={values.notes}
                onChange={(e) => set('notes', e.target.value)}
              />
            </div>
          </div>
        </CollapsibleSection>
      </form>
    </Modal>
  );
}
