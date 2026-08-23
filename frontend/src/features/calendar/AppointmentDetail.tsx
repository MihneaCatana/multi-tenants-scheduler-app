import { useState, useMemo, useCallback, type ReactNode } from 'react';
import { Link, useParams } from 'react-router-dom';
import { format } from 'date-fns';
import { Button } from 'primereact/button';
import { Badge } from 'primereact/badge';
import { InputTextarea } from 'primereact/inputtextarea';
import { InputText } from 'primereact/inputtext';
import { Message } from 'primereact/message';
import { Dropdown } from 'primereact/dropdown';
import { Calendar } from 'primereact/calendar';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, ApiError } from '../../lib/api';
import type { AppointmentStatus, AppointmentAction, AppointmentDetail as AppointmentDetailData, AppointmentStatusHistory } from '../../lib/types';
import { AppLayout } from '../../components/AppLayout';
import { Modal } from '../../components/Modal';
import { Spinner } from '../../components/Spinner';
import { EmptyState } from '../../components/EmptyState';
import { LEGAL_ACTIONS, STATUS_BADGE_TONE } from './lifecycle';
import { useFlag } from '../flags/hooks';
import { FeatureFlag } from '../../lib/flags';
import { useI18n, type TFn } from '../../lib/i18n';

/* -------------------------------------------------------------------------- */
/*  Tone -> PrimeReact Badge severity mapping                                   */
/* -------------------------------------------------------------------------- */

const TONE_TO_SEVERITY: Record<string, 'success' | 'secondary' | 'danger' | 'warning' | 'info'> = {
  neutral: 'secondary',
  green: 'success',
  amber: 'warning',
  red: 'danger',
  brand: 'info',
};

/* -------------------------------------------------------------------------- */
/*  Helpers                                                                   */
/* -------------------------------------------------------------------------- */

function fmtStatus(s: AppointmentStatus) {
  return s.replace('_', ' ');
}

function actionLabel(action: AppointmentAction, t: TFn): string {
  const map: Record<AppointmentAction, string> = {
    cancel: t('appt_actionCancel'),
    check_in: t('appt_actionCheckIn'),
    start: t('appt_actionStart'),
    complete: t('appt_actionComplete'),
    no_show: t('appt_actionNoShow'),
    reschedule: t('appt_actionReschedule'),
  };
  return map[action] ?? action;
}

/**
 * Build a Google Calendar \"Add Event\" URL from appointment data.
 */
function googleCalendarUrl(
  detail: AppointmentDetailData,
  resourcesMap: Record<string, string>,
  servicesMap: Record<string, string>,
  clientName: string,
): string {
  const fmt = (d: string) => format(new Date(d), "yyyyMMdd'T'HHmmss'Z'");
  const resourceNames = detail.resources.map((r) => resourcesMap[r.resourceId] ?? r.resourceId);
  const serviceName = detail.serviceIds?.length > 0
    ? (servicesMap[detail.serviceIds[0]!] ?? '')
    : '';

  const params = new URLSearchParams({
    action: 'TEMPLATE',
    text: detail.summary || serviceName || 'Appointment',
    dates: `${fmt(detail.startAt)}/${fmt(detail.endAt)}`,
    details: [
      resourceNames.length && `Resources: ${resourceNames.join(', ')}`,
      serviceName && `Service: ${serviceName}`,
      clientName && `Client: ${clientName}`,
      `Status: ${detail.status.replace('_', ' ')}`,
    ]
      .filter(Boolean)
      .join('\n'),
  });
  return `https://calendar.google.com/calendar/render?${params.toString()}`;
}

/* -------------------------------------------------------------------------- */
/*  Field component                                                           */
/* -------------------------------------------------------------------------- */

function Field({ label, error, children }: { label: string; error?: string; children: ReactNode }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
      <label style={{ fontSize: '0.875rem', fontWeight: 500 }}>{label}</label>
      {children}
      {error && (
        <small className="field-error" style={{ color: 'var(--red-500)', fontSize: '0.75rem' }}>
          {error}
        </small>
      )}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/*  Status history timeline                                                   */
/* -------------------------------------------------------------------------- */

const DOT_COLOR_MAP: Record<string, string> = {
  completed: 'var(--green-500)',
  cancelled: 'var(--text-color-secondary)',
  no_show: 'var(--text-color-secondary)',
  requested: 'var(--orange-400)',
};

function StatusHistory({ history, t }: { history: AppointmentStatusHistory[]; t: TFn }) {
  if (history.length === 0) return null;

  return (
    <div style={{ marginTop: '1.5rem' }}>
      <h3 style={{ fontSize: '0.875rem', fontWeight: 600, marginBottom: '1rem' }}>{t('apptDet_statusHistory')}</h3>
      <div style={{ position: 'relative', paddingLeft: '1.5rem' }}>
        {/* Vertical line */}
        <div style={{ position: 'absolute', left: '0.5rem', top: '0.5rem', bottom: '0.5rem', width: '1px', backgroundColor: 'var(--surface-border)' }} />
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
          {history.map((h) => {
            const dotColor = DOT_COLOR_MAP[h.toStatus] ?? 'var(--primary-color)';
            return (
              <div key={h.id} style={{ position: 'relative' }}>
                {/* Dot */}
                <div
                  style={{
                    position: 'absolute',
                    left: '-1rem',
                    top: '0.5rem',
                    width: '0.625rem',
                    height: '0.625rem',
                    borderRadius: '50%',
                    backgroundColor: dotColor,
                    border: '2px solid var(--surface-ground)',
                  }}
                />
                <div
                  style={{
                    borderRadius: '0.5rem',
                    border: '1px solid var(--surface-border)',
                    backgroundColor: 'var(--surface-card)',
                    padding: '0.75rem',
                    fontSize: '0.875rem',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '0.25rem',
                    flexWrap: 'wrap',
                  }}
                >
                  {h.fromStatus ? (
                    <>
                      <Badge severity={TONE_TO_SEVERITY[STATUS_BADGE_TONE[h.fromStatus]] ?? 'secondary'}>
                        {fmtStatus(h.fromStatus)}
                      </Badge>
                      <span style={{ margin: '0 0.375rem', color: 'var(--text-color-secondary)' }}>\u2192</span>
                    </>
                  ) : (
                    <span style={{ color: 'var(--text-color-secondary)' }}>{t('apptDet_created')}</span>
                  )}
                  <Badge severity={TONE_TO_SEVERITY[STATUS_BADGE_TONE[h.toStatus]] ?? 'secondary'}>
                    {fmtStatus(h.toStatus)}
                  </Badge>
                  <span style={{ marginLeft: '0.5rem', color: 'var(--text-color-secondary)' }}>
                    {format(new Date(h.createdAt), 'MMM d, yyyy HH:mm')}
                  </span>
                </div>
                {h.note && (
                  <p style={{ marginTop: '0.25rem', color: 'var(--text-color-secondary)', fontStyle: 'italic', fontSize: '0.875rem' }}>
                    {h.note}
                  </p>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/*  Action modals                                                             */
/* -------------------------------------------------------------------------- */

/* Cancel modal */
function CancelModal({
  open,
  onClose,
  appointmentId,
}: {
  open: boolean;
  onClose: () => void;
  appointmentId: string;
}) {
  const { t } = useI18n();
  const queryClient = useQueryClient();
  const [reason, setReason] = useState('');
  const [error, setError] = useState('');

  const mutation = useMutation({
    mutationFn: () => {
      const clean = (v: string) => (v && v.trim() ? v.trim() : undefined);
      return api.patchAppointment(appointmentId, {
        action: 'cancel',
        reason: clean(reason),
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['appointments'] });
      queryClient.invalidateQueries({ queryKey: ['appointment', appointmentId] });
      queryClient.invalidateQueries({ queryKey: ['appointment', appointmentId, 'history'] });
      onClose();
      setReason('');
      setError('');
    },
    onError: (err) => {
      setError(err instanceof ApiError ? err.message : t('common_error'));
    },
  });

  const onSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (reason.length > 200) {
      setError('Max 200 characters');
      return;
    }
    mutation.mutate();
  };

  return (
    <Modal
      open={open}
      title={t('apptDet_cancelTitle')}
      onClose={onClose}
      footer={
        <>
          <Button type="button" label={t('common_cancel')} severity="secondary" outlined size="small" onClick={onClose} />
          <Button type="submit" form="cancel-form" label={t('apptDet_cancelButton')} disabled={mutation.isPending} />
        </>
      }
    >
      <form id="cancel-form" onSubmit={onSubmit}>
        {mutation.isError && error && (
          <Message severity="error" style={{ marginBottom: '0.75rem' }} text={error} />
        )}
        <Field label={t('apptDet_cancelReasonLabel')} error={undefined}>
          <InputTextarea
            rows={3}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
          />
        </Field>
      </form>
    </Modal>
  );
}

/* Reschedule modal */
function RescheduleModal({
  open,
  onClose,
  appointmentId,
  currentDurationMinutes,
}: {
  open: boolean;
  onClose: () => void;
  appointmentId: string;
  currentDurationMinutes: number;
}) {
  const { t } = useI18n();
  const queryClient = useQueryClient();
  const [startAt, setStartAt] = useState('');
  const [durationMinutes, setDurationMinutes] = useState(String(currentDurationMinutes));
  const [fieldError, setFieldError] = useState('');
  const [generalError, setGeneralError] = useState('');

  const mutation = useMutation({
    mutationFn: () =>
      api.patchAppointment(appointmentId, {
        action: 'reschedule',
        startAt: new Date(startAt).toISOString(),
        durationMinutes: Number(durationMinutes),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['appointments'] });
      queryClient.invalidateQueries({ queryKey: ['appointment', appointmentId] });
      queryClient.invalidateQueries({ queryKey: ['appointment', appointmentId, 'history'] });
      onClose();
      setStartAt('');
      setDurationMinutes(String(currentDurationMinutes));
      setFieldError('');
      setGeneralError('');
    },
    onError: (err) => {
      if (err instanceof ApiError && err.status === 409) {
        setFieldError(err.message);
      } else {
        setGeneralError(err instanceof ApiError ? err.message : t('common_error'));
      }
    },
  });

  const onSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!startAt || !new Date(startAt).getTime()) {
      setFieldError('Start time is required');
      return;
    }
    mutation.mutate();
  };

  let dateValue: Date | undefined;
  if (startAt) {
    const d = new Date(startAt);
    if (!isNaN(d.getTime())) dateValue = d;
  }

  return (
    <Modal
      open={open}
      title={t('apptDet_rescheduleTitle')}
      onClose={onClose}
      footer={
        <>
          <Button type="button" label={t('common_cancel')} severity="secondary" outlined size="small" onClick={onClose} />
          <Button type="button" label={t('apptDet_rescheduleButton')} disabled={mutation.isPending} onClick={onSubmit} />
        </>
      }
    >
      {generalError && (
        <Message severity="error" style={{ marginBottom: '0.75rem' }} text={generalError} />
      )}
      <form onSubmit={onSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
        <Field label={t('apptDet_rescheduleFieldNewStart')} error={fieldError || undefined}>
          <Calendar
            value={dateValue}
            onChange={(e) => {
              if (e.value) {
                const d = e.value as Date;
                const pad = (n: number) => String(n).padStart(2, '0');
                const local = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
                setStartAt(local);
                setFieldError('');
              }
            }}
            showTime
            hourFormat="24"
            showIcon
          />
        </Field>
        <Field label={t('apptDet_rescheduleFieldDuration')}>
          <InputText
            type="number"
            min={1}
            step={1}
            value={durationMinutes}
            onChange={(e) => setDurationMinutes(e.target.value)}
          />
        </Field>
      </form>
    </Modal>
  );
}

/* Note modal (check_in / start / complete / no_show) */
function NoteModal({
  open,
  onClose,
  appointmentId,
  action,
  title,
  submitLabel,
}: {
  open: boolean;
  onClose: () => void;
  appointmentId: string;
  action: 'check_in' | 'start' | 'complete' | 'no_show';
  title: string;
  submitLabel: string;
}) {
  const { t } = useI18n();
  const queryClient = useQueryClient();
  const [note, setNote] = useState('');
  const [error, setError] = useState('');

  const mutation = useMutation({
    mutationFn: () => {
      const clean = (v: string) => (v && v.trim() ? v.trim() : undefined);
      return api.patchAppointment(appointmentId, {
        action,
        note: clean(note),
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['appointments'] });
      queryClient.invalidateQueries({ queryKey: ['appointment', appointmentId] });
      queryClient.invalidateQueries({ queryKey: ['appointment', appointmentId, 'history'] });
      onClose();
      setNote('');
      setError('');
    },
    onError: (err) => {
      setError(err instanceof ApiError ? err.message : t('common_error'));
    },
  });

  const onSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (note.length > 500) {
      setError('Max 500 characters');
      return;
    }
    mutation.mutate();
  };

  return (
    <Modal
      open={open}
      title={title}
      onClose={onClose}
      footer={
        <>
          <Button type="button" label={t('common_cancel')} severity="secondary" outlined size="small" onClick={onClose} />
          <Button type="submit" form="note-form" label={submitLabel} disabled={mutation.isPending} />
        </>
      }
    >
      <form id="note-form" onSubmit={onSubmit}>
        {error && (
          <Message severity="error" style={{ marginBottom: '0.75rem' }} text={error} />
        )}
        <Field label={t('apptDet_noteLabel')} error={undefined}>
          <InputTextarea
            rows={3}
            value={note}
            onChange={(e) => setNote(e.target.value)}
          />
        </Field>
      </form>
    </Modal>
  );
}

/* -------------------------------------------------------------------------- */
/*  Main page component                                                       */
/* -------------------------------------------------------------------------- */

export function AppointmentDetail() {
  const { t } = useI18n();
  const enabled = useFlag(FeatureFlag.APPOINTMENTS);
  const { id } = useParams<{ id: string }>();

  /* ---- modal state ----------------------------------------------------- */
  const [activeAction, setActiveAction] = useState<AppointmentAction | null>(null);

  /* ---- data queries ---------------------------------------------------- */
  const detailQuery = useQuery({
    queryKey: ['appointment', id],
    queryFn: () => api.getAppointment(id!),
    enabled: !!id && enabled,
  });

  const resourcesQuery = useQuery({
    queryKey: ['resources'],
    queryFn: () => api.listResources(),
    enabled,
  });

  const servicesQuery = useQuery({
    queryKey: ['services'],
    queryFn: () => api.listServices(),
    enabled,
  });

  const historyQuery = useQuery({
    queryKey: ['appointment', id, 'history'],
    queryFn: () => api.getAppointmentHistory(id!),
    enabled: !!id && enabled,
  });

  const detail = detailQuery.data;

  const clientQuery = useQuery({
    queryKey: ['client', detail?.clientId],
    queryFn: () => api.getClient(detail!.clientId!),
    enabled: !!detail?.clientId,
  });

  /* ---- lookup maps ----------------------------------------------------- */
  const resourcesMap = useMemo(() => {
    const map: Record<string, string> = {};
    if (resourcesQuery.data) {
      for (const r of resourcesQuery.data.resources) map[r.id] = r.name;
    }
    return map;
  }, [resourcesQuery.data]);

  const servicesMap = useMemo(() => {
    const map: Record<string, string> = {};
    if (servicesQuery.data) {
      for (const s of servicesQuery.data.services) map[s.id] = s.name;
    }
    return map;
  }, [servicesQuery.data]);

  /* ---- computed -------------------------------------------------------- */
  const legalActions: AppointmentAction[] = detail ? LEGAL_ACTIONS[detail.status] : [];
  const clientName: string = clientQuery.data?.name ?? '';
  const pendingAction = activeAction !== null;

  const handleOpenGoogleCalendar = useCallback(() => {
    const url = googleCalendarUrl(detail!, resourcesMap, servicesMap, clientName);
    window.open(url, '_blank');
  }, [detail, resourcesMap, servicesMap, clientName]);

  /* ---- feature flag gate ----------------------------------------------- */
  if (!enabled) {
    return (
      <AppLayout title={t('apptDet_title')}>
        <EmptyState>{t('apptDet_unavailable')}</EmptyState>
      </AppLayout>
    );
  }

  /* ---- loading --------------------------------------------------------- */
  if (detailQuery.isLoading || historyQuery.isLoading) {
    return (
      <AppLayout title={t('apptDet_title')}>
        <div style={{ display: 'flex', justifyContent: 'center', padding: '4rem 0' }}>
          <Spinner />
        </div>
      </AppLayout>
    );
  }

  /* ---- error ----------------------------------------------------------- */
  if (detailQuery.isError) {
    return (
      <AppLayout title={t('apptDet_title')}>
        <Message
          severity="error"
          text={detailQuery.error instanceof ApiError
            ? detailQuery.error.message
            : t('apptDet_errorLoad')}
        />
      </AppLayout>
    );
  }

  if (!detail) return null;

  /* ---- action dropdown options ----------------------------------------- */
  const actionItems = [
    { label: fmtStatus(detail.status), value: detail.status, disabled: true },
    ...legalActions.map((action) => ({
      label: actionLabel(action, t),
      value: action,
      command: () => setActiveAction(action),
    })),
  ];

  /* ---- render ---------------------------------------------------------- */
  return (
    <AppLayout title={t('apptDet_title')}>
      <Link
        to="/workspace/calendar"
        style={{
          fontSize: '0.875rem',
          marginBottom: '1rem',
          display: 'inline-block',
          color: 'var(--primary-color)',
          textDecoration: 'none',
        }}
      >
        {t('apptDet_backToAppointments')}
      </Link>

      {/* ---- Appointment card ------------------------------------------ */}
      <div
        style={{
          borderRadius: '0.5rem',
          border: '1px solid var(--surface-border)',
          backgroundColor: 'var(--surface-card)',
          padding: '1.5rem',
          marginBottom: '1rem',
          boxShadow: '0 1px 3px rgba(0,0,0,0.08)',
        }}
      >
        <div style={{ marginBottom: '1rem' }}>
          <p style={{ fontSize: '0.875rem', margin: 0 }}>
            <span style={{ fontWeight: 600 }}>{t('apptDet_start')}</span>{' '}
            {format(new Date(detail.startAt), 'EEEE, MMM d, yyyy \u00b7 HH:mm')}
          </p>
          <p style={{ fontSize: '0.875rem', marginTop: '0.25rem', marginBottom: 0 }}>
            <span style={{ fontWeight: 600 }}>{t('apptDet_end')}</span>{' '}
            {format(new Date(detail.endAt), 'EEEE, MMM d, yyyy \u00b7 HH:mm')}
          </p>
          <p style={{ fontSize: '0.875rem', marginTop: '0.25rem', marginBottom: 0 }}>
            <span style={{ fontWeight: 600 }}>{t('apptDet_duration')}</span>{' '}
            {Math.round((new Date(detail.endAt).getTime() - new Date(detail.startAt).getTime()) / 60_000)} {t('common_minutes')}
          </p>
          <p style={{ fontSize: '0.875rem', marginTop: '0.25rem', marginBottom: 0 }}>
            <span style={{ fontWeight: 600 }}>{t('apptDet_client')}</span>{' '}
            {detail.clientId ? (
              clientQuery.data ? (
                <Link to={`/workspace/clients/${detail.clientId}`} style={{ color: 'var(--primary-color)', textDecoration: 'none' }}>
                  {clientQuery.data.name}
                </Link>
              ) : '\u2026'
            ) : (
              <span style={{ color: 'var(--text-color-secondary)' }}>{t('apptDet_walkIn')}</span>
            )}
          </p>
        </div>

        {detail.summary && (
          <p style={{ fontSize: '0.875rem', marginBottom: '0.5rem' }}>
            <span style={{ fontWeight: 600 }}>{t('apptDet_summary')}</span> {detail.summary}
          </p>
        )}

        {detail.notes && (
          <p style={{ fontSize: '0.875rem', marginBottom: '0.5rem' }}>
            <span style={{ fontWeight: 600 }}>{t('apptDet_notes')}</span> {detail.notes}
          </p>
        )}

        {detail.status === 'cancelled' && detail.cancellationReason && (
          <p style={{ fontSize: '0.875rem', marginBottom: '0.5rem', color: 'var(--red-500)' }}>
            <span style={{ fontWeight: 600 }}>{t('apptDet_cancellationReason')}</span>{' '}
            {detail.cancellationReason}
          </p>
        )}

        {detail.serviceIds && detail.serviceIds.length > 0 ? (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.375rem', marginBottom: '0.5rem' }}>
            {detail.serviceIds.map((sid) => (
              <Badge key={sid} severity="secondary" style={{ fontSize: '0.75rem' }}>
                {servicesMap[sid] ?? '\u2014'}
              </Badge>
            ))}
          </div>
        ) : (
          <p style={{ fontSize: '0.875rem', marginBottom: '0.5rem' }}>\u2014</p>
        )}

        <div style={{ fontSize: '0.875rem' }}>
          <span style={{ fontWeight: 600 }}>{t('apptDet_resources')}</span>
          <div style={{ marginTop: '0.25rem', display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
            {detail.resources.map((r) => (
              <div key={r.id} style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                <span>{resourcesMap[r.resourceId] ?? r.resourceId}</span>
                <Badge severity={TONE_TO_SEVERITY[r.role === 'primary' ? 'brand' : 'neutral'] ?? 'secondary'}>
                  {r.role}
                </Badge>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* ---- Status & actions bar -------------------------------------- */}
      <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '0.75rem', marginBottom: '1rem' }}>
        {legalActions.length > 0 ? (
          <Dropdown
            value={detail.status}
            options={actionItems}
            onChange={(e) => {
              const val = e.value;
              if (val && val !== detail.status) setActiveAction(val as AppointmentAction);
            }}
            disabled={pendingAction}
            style={{ width: '180px' }}
            aria-label={t('appt_actionChangeStatus')}
          />
        ) : (
          <Badge severity={TONE_TO_SEVERITY[STATUS_BADGE_TONE[detail.status]] ?? 'secondary'}>
            {fmtStatus(detail.status)}
          </Badge>
        )}

        <Button
          severity="secondary" outlined
          size="small"
          icon="pi pi-calendar"
          label={t('apptDet_googleCalendar')}
          onClick={handleOpenGoogleCalendar}
        />
      </div>

      {/* ---- Status history -------------------------------------------- */}
      {historyQuery.data && (
        <StatusHistory history={historyQuery.data.history} t={t} />
      )}

      {/* ---- Action modals ---------------------------------------------- */}
      <CancelModal
        open={activeAction === 'cancel'}
        onClose={() => setActiveAction(null)}
        appointmentId={id!}
      />

      <RescheduleModal
        open={activeAction === 'reschedule'}
        onClose={() => setActiveAction(null)}
        appointmentId={id!}
        currentDurationMinutes={
          detail
            ? Math.round((new Date(detail.endAt).getTime() - new Date(detail.startAt).getTime()) / 60_000)
            : 60
        }
      />

      {(activeAction === 'check_in' ||
        activeAction === 'start' ||
        activeAction === 'complete' ||
        activeAction === 'no_show') && (
          <NoteModal
            open
            onClose={() => setActiveAction(null)}
            appointmentId={id!}
            action={activeAction!}
            title={t('apptDet_actionNoteTitle', { action: actionLabel(activeAction!, t) })}
            submitLabel={actionLabel(activeAction!, t)}
          />
        )}
    </AppLayout>
  );
}
