import { useMemo, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { format } from 'date-fns';
import { DataTable } from 'primereact/datatable';
import { Column } from 'primereact/column';
import { Button } from 'primereact/button';
import { InputText } from 'primereact/inputtext';
import { InputTextarea } from 'primereact/inputtextarea';
import { Message } from 'primereact/message';
import { Badge } from 'primereact/badge';
import { Menu } from 'primereact/menu';
import type { MenuItem } from 'primereact/menuitem';
import { api, ApiError } from '../../lib/api';
import { AppLayout } from '../../components/AppLayout';
import { Spinner } from '../../components/Spinner';
import { EmptyState } from '../../components/EmptyState';
import { useI18n, type TFn } from '../../lib/i18n';
import { LEGAL_ACTIONS, STATUS_BADGE_TONE } from '../calendar/lifecycle';
import { PieChart, Pie, Cell, Tooltip, ResponsiveContainer, Legend } from 'recharts';
import type {
  AppointmentStatus,
  AppointmentAction,
  AppointmentActionBody,
  Service,
} from '../../lib/types';

/* -------------------------------------------------------------------------- */
/*  Tone -> Badge severity mapping                                              */
/* -------------------------------------------------------------------------- */

const TONE_TO_SEVERITY: Record<string, 'success' | 'info' | 'warning' | 'danger' | undefined> = {
  neutral: undefined,
  green: 'success',
  amber: 'warning',
  red: 'danger',
  brand: 'info',
};

/* -------------------------------------------------------------------------- */
/*  Helpers                                                                    */
/* -------------------------------------------------------------------------- */

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

/* -------------------------------------------------------------------------- */
/*  Form field helper                                                          */
/* -------------------------------------------------------------------------- */

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
        <small className="field-error" style={{ color: 'var(--primary-color)', fontSize: '0.75rem' }}>
          {error}
        </small>
      )}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/*  Inline form validation                                                     */
/* -------------------------------------------------------------------------- */

type ClientEditValues = {
  name: string;
  email: string;
  phone: string;
  notes: string;
};

function validateEdit(v: ClientEditValues): Partial<Record<keyof ClientEditValues, string>> {
  const errors: Partial<Record<keyof ClientEditValues, string>> = {};
  if (!v.name || v.name.trim().length === 0) errors.name = 'Name is required';
  if (v.name.length > 160) errors.name = 'Name is too long';
  if (v.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v.email)) errors.email = 'Enter a valid email';
  if (v.email.length > 254) errors.email = 'Email is too long';
  if (v.phone.length > 40) errors.phone = 'Phone is too long';
  if (v.notes.length > 5000) errors.notes = 'Notes are too long';
  return errors;
}

// Convert empty strings to undefined so we send clean optionals to the backend
// (the backend treats omitted optionals vs. "" differently).
function clean(v: ClientEditValues): { name: string; email?: string; phone?: string; notes?: string } {
  return {
    name: v.name.trim(),
    email: v.email.trim() || undefined,
    phone: v.phone.trim() || undefined,
    notes: v.notes.trim() || undefined,
  };
}

/* -------------------------------------------------------------------------- */
/*  ClientAppointmentsTable                                                     */
/* -------------------------------------------------------------------------- */

type AppointmentRow = {
  id: string;
  clientId: string | null;
  startAt: string;
  endAt: string;
  primaryResourceId: string;
  serviceIds: string[];
  status: AppointmentStatus;
  summary: string | null;
};

function ClientAppointmentsTable({
  appointments,
  resourcesMap,
  servicesMap,
  onQuickAction,
  isActionPending,
  t,
}: {
  appointments: AppointmentRow[];
  resourcesMap: Record<string, string>;
  servicesMap: Record<string, string>;
  onQuickAction: (appointmentId: string, action: AppointmentAction) => void;
  isActionPending: boolean;
  t: TFn;
}) {
  // A single Menu instance is reused; the active row is tracked so the action
  // handler knows which appointment to act on.
  const menuRef = useRef<Menu>(null);
  const [activeRow, setActiveRow] = useState<AppointmentRow | null>(null);

  if (appointments.length === 0) {
    return <EmptyState>{t('appt_noAppointments')}</EmptyState>;
  }

  const openActions = (e: React.MouseEvent, row: AppointmentRow) => {
    setActiveRow(row);
    menuRef.current?.toggle(e);
  };

  const buildItems = (row: AppointmentRow): MenuItem[] => {
    const legalActions = LEGAL_ACTIONS[row.status] ?? [];
    const items: MenuItem[] = [
      {
        label: t('appt_actionView'),
        icon: 'pi pi-eye',
        url: `/workspace/calendar/${row.id}`,
      },
    ];
    if (legalActions.length > 0) {
      items.push({ separator: true });
      for (const action of legalActions) {
        items.push({
          label: actionLabel(action, t),
          icon: isActionPending ? 'pi pi-spin pi-spinner' : 'pi pi-circle-fill',
          disabled: isActionPending,
          command: () => onQuickAction(row.id, action),
        });
      }
    }
    return items;
  };

  const items = activeRow ? buildItems(activeRow) : [];

  const startBody = (row: AppointmentRow) =>
    format(new Date(row.startAt), 'MMM d, HH:mm');
  const endBody = (row: AppointmentRow) =>
    format(new Date(row.endAt), 'MMM d, HH:mm');
  const resourceBody = (row: AppointmentRow) =>
    resourcesMap[row.primaryResourceId] ?? '—';
  const serviceBody = (row: AppointmentRow) => {
    const names = (row.serviceIds ?? []).map((sid) => servicesMap[sid]).filter(Boolean);
    if (names.length === 0) return '—';
    if (names.length === 1) return names[0];
    return `${names[0]} +${names.length - 1}`;
  };
  const statusBody = (row: AppointmentRow) => (
    <Badge
      value={row.status.replace('_', ' ')}
      severity={TONE_TO_SEVERITY[STATUS_BADGE_TONE[row.status]]}
    />
  );
  const summaryBody = (row: AppointmentRow) =>
    row.summary
      ? row.summary.length > 40
        ? `${row.summary.slice(0, 40)}…`
        : row.summary
      : '—';
  const actionsBody = (row: AppointmentRow) => (
    <Button
      type="button"
      icon="pi pi-ellipsis-v"
      text
      rounded
      size="small"
      aria-label={t('appt_srOpenMenu')}
      onClick={(e) => openActions(e, row)}
    />
  );

  return (
    <>
      <Menu model={items} popup ref={menuRef} />
      <DataTable
        value={appointments}
        dataKey="id"
        rowHover
        paginator
        rows={10}
        responsiveLayout="scroll"
        style={{ fontSize: '0.875rem' }}
      >
        <Column field="startAt" header={t('appt_colStart')} sortable body={startBody} style={{ whiteSpace: 'nowrap' }} />
        <Column field="endAt" header={t('appt_colEnd')} sortable body={endBody} style={{ whiteSpace: 'nowrap' }} />
        <Column field="primaryResourceId" header={t('appt_colResource')} body={resourceBody} />
        <Column field="serviceIds" header={t('appt_colService')} body={serviceBody} />
        <Column field="status" header={t('appt_colStatus')} sortable body={statusBody} />
        <Column field="summary" header={t('appt_colSummary')} body={summaryBody} />
        <Column header={t('appt_colActions')} body={actionsBody} style={{ width: '4rem', textAlign: 'center' }} />
      </DataTable>
    </>
  );
}

/* -------------------------------------------------------------------------- */
/*  ClientView                                                                 */
/* -------------------------------------------------------------------------- */

export function ClientView() {
  const { id } = useParams<{ id: string }>();
  const { t } = useI18n();

  const [editing, setEditing] = useState(false);
  // Edit form state (one useState per field).
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [notes, setNotes] = useState('');
  const [errors, setErrors] = useState<Partial<Record<keyof ClientEditValues, string>>>({});

  const qc = useQueryClient();

  const { data: client, isLoading, error } = useQuery({
    queryKey: ['client', id],
    queryFn: () => api.getClient(id!),
    enabled: !!id,
  });

  /* ---- lookup maps for appointment display ---- */
  const resourcesQuery = useQuery({
    queryKey: ['resources'],
    queryFn: () => api.listResources(),
    enabled: !!id,
  });

  const servicesQuery = useQuery({
    queryKey: ['services'],
    queryFn: () => api.listServices(),
    enabled: !!id,
  });

  const resourcesMap = useMemo(() => {
    const map: Record<string, string> = {};
    if (resourcesQuery.data) {
      for (const r of resourcesQuery.data.resources) {
        map[r.id] = `${r.name} (${r.type})`;
      }
    }
    return map;
  }, [resourcesQuery.data]);

  const servicesMap = useMemo(() => {
    const map: Record<string, string> = {};
    if (servicesQuery.data) {
      for (const s of servicesQuery.data.services) {
        map[s.id] = s.name;
      }
    }
    return map;
  }, [servicesQuery.data]);

  /* ---- services by id (includes price) ---- */
  const servicesById = useMemo(() => {
    const map: Record<string, Service> = {};
    if (servicesQuery.data) {
      for (const s of servicesQuery.data.services) {
        map[s.id] = s;
      }
    }
    return map;
  }, [servicesQuery.data]);

  /* ---- client appointments ---- */
  const appointmentsQuery = useQuery({
    queryKey: ['client-appointments', id],
    queryFn: () => api.listAppointments({ clientId: id! }),
    enabled: !!id,
  });

  /* ---- inline status action mutation ---- */
  const actionMutation = useMutation({
    mutationFn: ({ id: aptId, body }: { id: string; body: AppointmentActionBody }) =>
      api.patchAppointment(aptId, body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['client-appointments', id] });
    },
  });

  const handleQuickAction = (appointmentId: string, action: AppointmentAction) => {
    actionMutation.mutate({
      id: appointmentId,
      body: { action } as AppointmentActionBody,
    });
  };

  /* ---- edit mutation ---- */
  const updateMutation = useMutation({
    mutationFn: (values: ClientEditValues) => api.updateClient(id!, clean(values)),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['client', id] });
      qc.invalidateQueries({ queryKey: ['clients'] });
      setEditing(false);
    },
  });

  const startEditing = () => {
    if (!client) return;
    setName(client.name);
    setEmail(client.email ?? '');
    setPhone(client.phone ?? '');
    setNotes(client.notes ?? '');
    setErrors({});
    setEditing(true);
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const values: ClientEditValues = { name, email, phone, notes };
    const validation = validateEdit(values);
    setErrors(validation);
    if (Object.keys(validation).length > 0) return;
    updateMutation.mutate(values);
  };

  const cardStyle: React.CSSProperties = {
    backgroundColor: 'var(--surface-card)',
    border: '1px solid var(--surface-border)',
    borderRadius: 'var(--content-border-radius)',
    padding: '1.5rem',
  };

  /* ---- financial stats (computed from appointments + services) ---- */
  const financialStats = useMemo(() => {
    const appointments = appointmentsQuery.data?.appointments ?? [];
    const completed = appointments.filter((a) => a.status === 'completed');
    const cancelled = appointments.filter((a) => a.status === 'cancelled');
    const noShow = appointments.filter((a) => a.status === 'no_show');
    const upcoming = appointments.filter((a) => a.status === 'confirmed' || a.status === 'checked_in' || a.status === 'in_progress');

    let totalSpent = 0;
    for (const a of completed) {
      for (const sid of a.serviceIds ?? []) {
        const svc = servicesById[sid];
        if (svc?.price != null) totalSpent += Number(svc.price);
      }
    }

    const statusBreakdown = [
      { name: 'Completed', value: completed.length, fill: 'hsl(161, 74%, 38%)' },
      { name: 'Cancelled', value: cancelled.length, fill: 'hsl(0, 0%, 40%)' },
      { name: 'No show', value: noShow.length, fill: 'hsl(32, 90%, 46%)' },
      { name: 'Upcoming', value: upcoming.length, fill: 'hsl(15, 96%, 68%)' },
    ].filter((d) => d.value > 0);

    return {
      totalSpent,
      completedCount: completed.length,
      avgPerAppointment: completed.length > 0 ? totalSpent / completed.length : 0,
      upcomingCount: upcoming.length,
      statusBreakdown,
    };
  }, [appointmentsQuery.data, servicesById]);

  return (
    <AppLayout
      title={client?.name ?? t('client_detailsTitle')}
      actions={
        <Link to="/workspace/clients">
          <Button type="button" label={t('client_back')} outlined size="small" />
        </Link>
      }
    >
      {isLoading ? (
        <div style={{ display: 'flex', justifyContent: 'center', padding: '4rem 0' }}>
          <Spinner />
        </div>
      ) : error ? (
        <Message
          severity="error"
          text={error instanceof ApiError ? error.message : t('client_notFound')}
        />
      ) : client ? (
        <div className="client-two-col" style={{ maxWidth: '72rem', display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1.5rem', alignItems: 'start' }}>
          {/* ---- Left column: Client info + Appointment history ---- */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
            <div className="card" style={cardStyle}>
              {editing ? (
                <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
                  <h2 style={{ fontSize: '1.25rem', fontWeight: 600, color: 'var(--text-color)', margin: 0 }}>
                    Edit client
                  </h2>

                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(14rem, 1fr))', gap: '1.25rem' }}>
                    <Field label="Name" error={errors.name}>
                      <InputText value={name} onChange={(e) => setName(e.target.value)} />
                    </Field>
                    <Field label="Email" error={errors.email}>
                      <InputText value={email} onChange={(e) => setEmail(e.target.value)} placeholder="email@example.com" />
                    </Field>
                    <Field label="Phone" error={errors.phone}>
                      <InputText value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="+40 ..." />
                    </Field>
                  </div>

                  <Field label="Notes" error={errors.notes}>
                    <InputTextarea rows={4} value={notes} onChange={(e) => setNotes(e.target.value)} autoResize />
                  </Field>

                  {updateMutation.error && (
                    <Message
                      severity="error"
                      text={
                        updateMutation.error instanceof ApiError
                          ? updateMutation.error.message
                          : 'Failed to update client.'
                      }
                    />
                  )}

                  <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.75rem', paddingTop: '0.5rem' }}>
                    <Button
                      type="button"
                      label="Cancel"
                      outlined
                      size="small"
                      onClick={() => setEditing(false)}
                    />
                    <Button
                      type="submit"
                      label={updateMutation.isPending ? 'Saving…' : 'Save changes'}
                      size="small"
                      disabled={updateMutation.isPending}
                    />
                  </div>
                </form>
              ) : (
                <>
                  <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: '1.5rem' }}>
                    <h2 style={{ fontSize: '1.25rem', fontWeight: 600, color: 'var(--text-color)', margin: 0 }}>
                      {client.name}
                    </h2>
                    <Button
                      type="button"
                      label="Edit"
                      outlined
                      size="small"
                      onClick={startEditing}
                    />
                  </div>

                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(14rem, 1fr))', gap: '1.5rem' }}>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
                      <label style={{ fontSize: '0.875rem', fontWeight: 500, color: 'var(--text-color)' }}>
                        {t('clients_fieldEmail')}
                      </label>
                      <div style={{ fontSize: '0.875rem', color: client.email ? 'var(--text-color)' : 'var(--text-color-secondary)' }}>
                        {client.email ? (
                          <a href={`mailto:${client.email}`} style={{ color: 'var(--primary-color)', textDecoration: 'none' }}>
                            {client.email}
                          </a>
                        ) : (
                          t('client_noEmail')
                        )}
                      </div>
                    </div>

                    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
                      <label style={{ fontSize: '0.875rem', fontWeight: 500, color: 'var(--text-color)' }}>
                        {t('clients_fieldPhone')}
                      </label>
                      <div style={{ fontSize: '0.875rem', color: client.phone ? 'var(--text-color)' : 'var(--text-color-secondary)' }}>
                        {client.phone ? (
                          <a href={`tel:${client.phone}`} style={{ color: 'var(--primary-color)', textDecoration: 'none' }}>
                            {client.phone}
                          </a>
                        ) : (
                          t('client_noPhone')
                        )}
                      </div>
                    </div>

                    <div
                      style={{
                        gridColumn: '1 / -1',
                        paddingTop: '1rem',
                        borderTop: '1px solid var(--surface-border)',
                        display: 'flex',
                        flexDirection: 'column',
                        gap: '0.25rem',
                      }}
                    >
                      <label style={{ fontSize: '0.875rem', fontWeight: 500, color: 'var(--text-color)' }}>
                        {t('clients_fieldNotes')}
                      </label>
                      {client.notes ? (
                        <p style={{ fontSize: '0.875rem', whiteSpace: 'pre-wrap', lineHeight: 1.6, color: 'var(--text-color)', margin: 0 }}>
                          {client.notes}
                        </p>
                      ) : (
                        <p style={{ fontSize: '0.875rem', fontStyle: 'italic', color: 'var(--text-color-secondary)', margin: 0 }}>
                          {t('client_noNotes')}
                        </p>
                      )}
                    </div>
                  </div>

                  <div style={{ marginTop: '2rem', display: 'flex', justifyContent: 'flex-end' }}>
                    <span style={{ fontSize: '0.75rem', color: 'var(--text-color-secondary)' }}>
                      {t('client_updated')}: {new Date(client.updatedAt).toLocaleString()}
                    </span>
                  </div>
                </>
              )}
            </div>

            {/* ---- Appointment History ---- */}
            <div className="card" style={cardStyle}>
              <h2 style={{ fontSize: '1.25rem', fontWeight: 600, color: 'var(--text-color)', margin: '0 0 1rem' }}>
                {t('client_appointmentHistory')}
              </h2>

              {appointmentsQuery.isLoading && (
                <div style={{ display: 'flex', justifyContent: 'center', padding: '2rem 0' }}>
                  <Spinner />
                </div>
              )}

              {appointmentsQuery.isError && (
                <Message
                  severity="error"
                  text={
                    appointmentsQuery.error instanceof ApiError
                      ? appointmentsQuery.error.message
                      : t('appt_errorLoad')
                  }
                />
              )}

              {appointmentsQuery.isSuccess && (
                <div style={{ overflowX: 'auto' }}>
                  <ClientAppointmentsTable
                    appointments={appointmentsQuery.data.appointments}
                    resourcesMap={resourcesMap}
                    servicesMap={servicesMap}
                    onQuickAction={handleQuickAction}
                    isActionPending={actionMutation.isPending}
                    t={t}
                  />
                </div>
              )}
            </div>
          </div>

          {/* ---- Right column: Financial summary ---- */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
            {appointmentsQuery.isSuccess && appointmentsQuery.data.appointments.length > 0 ? (
              <>
                {/* Summary Cards */}
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '1rem' }}>
                  {[
                    { label: t('client_totalSpent'), value: financialStats.totalSpent.toLocaleString('ro-RO', { minimumFractionDigits: 2 }) + ' lei' },
                    { label: t('client_completed'), value: String(financialStats.completedCount) },
                    { label: t('client_avgPerAppointment'), value: financialStats.avgPerAppointment > 0 ? financialStats.avgPerAppointment.toLocaleString('ro-RO', { minimumFractionDigits: 2 }) + ' lei' : '—' },
                    { label: t('client_upcoming'), value: String(financialStats.upcomingCount) },
                  ].map((card) => (
                    <div
                      key={card.label}
                      style={{
                        backgroundColor: 'var(--surface-card)',
                        border: '1px solid var(--surface-border)',
                        borderRadius: 'var(--content-border-radius)',
                        padding: '1rem 1.25rem',
                        display: 'flex',
                        flexDirection: 'column',
                        gap: '0.25rem',
                      }}
                    >
                      <span style={{ fontSize: '0.75rem', fontWeight: 500, color: 'var(--muted-foreground)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                        {card.label}
                      </span>
                      <span style={{ fontSize: '1.5rem', fontWeight: 700, color: 'var(--foreground)' }}>
                        {card.value}
                      </span>
                    </div>
                  ))}
                </div>

                {/* Donut Chart */}
                {financialStats.statusBreakdown.length > 0 && (
                  <div className="card" style={cardStyle}>
                    <h2 style={{ fontSize: '1.25rem', fontWeight: 600, color: 'var(--text-color)', margin: '0 0 1rem' }}>
                      {t('client_statusBreakdown')}
                    </h2>
                    <div style={{ display: 'flex', justifyContent: 'center' }}>
                      <ResponsiveContainer width="100%" height={260}>
                        <PieChart>
                          <Pie
                            data={financialStats.statusBreakdown}
                            cx="50%"
                            cy="50%"
                            innerRadius={60}
                            outerRadius={100}
                            paddingAngle={3}
                            dataKey="value"
                            strokeWidth={0}
                          >
                            {financialStats.statusBreakdown.map((entry, i) => (
                              <Cell key={i} fill={entry.fill} />
                            ))}
                          </Pie>
                          <Tooltip
                            formatter={(value) => [value, 'Appointments']}
                            contentStyle={{
                              backgroundColor: 'var(--surface-card)',
                              border: '1px solid var(--surface-border)',
                              borderRadius: 'var(--content-border-radius)',
                              color: 'var(--text-color)',
                              fontSize: '0.8125rem',
                            }}
                            itemStyle={{ color: 'var(--text-color)' }}
                            labelStyle={{ color: 'var(--text-color-secondary)', fontWeight: 600 }}
                          />
                          <Legend
                            verticalAlign="bottom"
                            iconType="circle"
                            iconSize={8}
                            formatter={(value: string) => <span style={{ fontSize: '0.875rem', color: 'var(--foreground)' }}>{value}</span>}
                          />
                        </PieChart>
                      </ResponsiveContainer>
                    </div>
                  </div>
                )}
              </>
            ) : (
              <div className="card" style={{ ...cardStyle, textAlign: 'center', padding: '3rem 1.5rem' }}>
                <span style={{ fontSize: '0.875rem', color: 'var(--muted-foreground)' }}>
                  {t('appt_noAppointments')}
                </span>
              </div>
            )}
          </div>
        </div>
      ) : null}
    </AppLayout>
  );
}
