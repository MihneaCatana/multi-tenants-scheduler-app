import { useState, useRef } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { format } from 'date-fns';
import { DataTable } from 'primereact/datatable';
import { Column } from 'primereact/column';
import { Button } from 'primereact/button';
import { InputText } from 'primereact/inputtext';
import { Dropdown } from 'primereact/dropdown';
import { Message } from 'primereact/message';
import { Badge } from 'primereact/badge';
import { Menu } from 'primereact/menu';
import type { MenuItem } from 'primereact/menuitem';
import { Calendar } from 'primereact/calendar';
import { api } from '../../../lib/api';
import { Spinner } from '../../../components/Spinner';
import { EmptyState } from '../../../components/EmptyState';
import { LEGAL_ACTIONS, STATUS_BADGE_TONE, ALL_STATUSES } from '../../calendar/lifecycle';
import { useI18n, type TFn } from '../../../lib/i18n';
import type { Appointment, AppointmentStatus, AppointmentAction, AppointmentActionBody, Resource, Service, Client } from '../../../lib/types';

// ---------------------------------------------------------------------------
//  Tone -> Badge severity mapping
// ---------------------------------------------------------------------------

const TONE_TO_SEVERITY: Record<string, 'success' | 'info' | 'warning' | 'danger' | undefined> = {
  neutral: undefined,
  green: 'success',
  amber: 'warning',
  red: 'danger',
  brand: 'info',
};

// ---------------------------------------------------------------------------
//  Helpers
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
//  Props
// ---------------------------------------------------------------------------

interface Props {
  resourcesMap: Record<string, string>;
  servicesMap: Record<string, string>;
  clientsMap: Record<string, string>;
  resourcesById: Record<string, Resource>;
  servicesById: Record<string, Service>;
  clientsById: Record<string, Client>;
}

// ---------------------------------------------------------------------------
//  AppointmentsTab
// ---------------------------------------------------------------------------

export function AppointmentsTab({
  resourcesMap,
  servicesMap,
  clientsMap,
}: Props) {
  const { t } = useI18n();
  const queryClient = useQueryClient();
  const menuRef = useRef<Menu>(null);
  const [activeRow, setActiveRow] = useState<Appointment | null>(null);

  // --- Filters ---
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<AppointmentStatus | ''>('');
  const [resourceFilter, setResourceFilter] = useState('');
  const [clientFilter, setClientFilter] = useState('');
  const [fromDate, setFromDate] = useState<Date | null>(null);
  const [toDate, setToDate] = useState<Date | null>(null);

  // --- Query ---
  const { data, isLoading, isError } = useQuery({
    queryKey: ['appointments', { statusFilter, resourceFilter, clientFilter, fromDate, toDate }],
    queryFn: () =>
      api.listAppointments({
        status: statusFilter || undefined,
        resourceId: resourceFilter || undefined,
        clientId: clientFilter || undefined,
        from: fromDate ? fromDate.toISOString() : undefined,
        to: toDate ? toDate.toISOString() : undefined,
        limit: 200,
      }),
  });

  const allAppointments = data?.appointments ?? [];

  // --- Client-side search filter ---
  const filtered = search.trim()
    ? allAppointments.filter((a) => {
        const q = search.toLowerCase();
        const clientName = a.clientId ? clientsMap[a.clientId] ?? '' : '';
        const summary = a.summary ?? '';
        return clientName.toLowerCase().includes(q) || summary.toLowerCase().includes(q);
      })
    : allAppointments;

  // --- Status action mutation ---
  const actionMutation = useMutation({
    mutationFn: ({ id, body }: { id: string; body: AppointmentActionBody }) =>
      api.patchAppointment(id, body),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['appointments'] });
    },
  });

  const openActions = (e: React.MouseEvent, row: Appointment) => {
    setActiveRow(row);
    menuRef.current?.toggle(e);
  };

  const buildItems = (row: Appointment): MenuItem[] => {
    const legal = LEGAL_ACTIONS[row.status] ?? [];
    const items: MenuItem[] = [
      {
        label: t('appt_actionView'),
        icon: 'pi pi-eye',
        url: '/workspace/calendar/' + row.id,
      },
    ];
    if (legal.length > 0) {
      items.push({ separator: true });
      for (const action of legal) {
        items.push({
          label: actionLabel(action, t),
          icon: actionMutation.isPending ? 'pi pi-spin pi-spinner' : 'pi pi-circle-fill',
          disabled: actionMutation.isPending,
          command: () => {
                const body: AppointmentActionBody =
                  action === 'reschedule'
                    ? { action, startAt: row.startAt }
                    : { action };
                actionMutation.mutate({ id: row.id, body });
              },
        });
      }
    }
    return items;
  };

  const items = activeRow ? buildItems(activeRow) : [];

  // --- Filter option builders ---
  const statusOptions = [
    { label: t('appt_filterAll'), value: '' },
    ...ALL_STATUSES.map((s) => ({ label: s.replace('_', ' '), value: s })),
  ];

  const resourceOptions = [
    { label: t('appt_filterAllResources'), value: '' },
    ...Object.entries(resourcesMap).map(([id, label]) => ({ label, value: id })),
  ];

  const clientOptions = [
    { label: t('appt_filterAllClients'), value: '' },
    ...Object.entries(clientsMap).map(([id, label]) => ({ label, value: id })),
  ];

  // --- Column body renderers ---
  const startBody = (row: Appointment) => format(new Date(row.startAt), 'MMM d, HH:mm');
  const endBody = (row: Appointment) => format(new Date(row.endAt), 'MMM d, HH:mm');
  const clientBody = (row: Appointment) =>
    row.clientId ? clientsMap[row.clientId] ?? '—' : '—';
  const serviceBody = (row: Appointment) => {
    const names = (row.serviceIds ?? []).map((sid) => servicesMap[sid]).filter(Boolean);
    if (names.length === 0) return '—';
    if (names.length === 1) return names[0];
    return names[0] + ' +' + String(names.length - 1);
  };
  const statusBody = (row: Appointment) => (
    <Badge
      value={row.status.replace('_', ' ')}
      severity={TONE_TO_SEVERITY[STATUS_BADGE_TONE[row.status]]}
    />
  );
  const summaryBody = (row: Appointment) =>
    row.summary
      ? row.summary.length > 40
        ? row.summary.slice(0, 40) + '…'
        : row.summary
      : '—';
  const actionsBody = (row: Appointment) => (
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

  // --- Clear filters ---
  const hasFilters = statusFilter || resourceFilter || clientFilter || fromDate || toDate || search;
  const clearFilters = () => {
    setSearch('');
    setStatusFilter('');
    setResourceFilter('');
    setClientFilter('');
    setFromDate(null);
    setToDate(null);
  };

  // --- Render ---
  if (isLoading) {
    return (
      <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', padding: '5rem 1rem' }}>
        <Spinner />
      </div>
    );
  }

  if (isError) {
    return <Message severity="error" text={t('appt_errorLoad')} />;
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
      {/* Filter bar */}
      <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '0.5rem' }}>
        <span style={{ fontSize: '0.875rem', fontWeight: 500, color: 'var(--text-color)' }}>{t('appt_filterSearch')}</span>
        <InputText
          style={{ minWidth: '12rem' }}
          placeholder={t('appt_filterSearchPlaceholder')}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />

        <Dropdown
          style={{ minWidth: '10rem' }}
          value={statusFilter}
          options={statusOptions}
          onChange={(e) => setStatusFilter(e.value ?? '')}
          placeholder={t('appt_filterStatus')}
        />

        <Dropdown
          style={{ minWidth: '12rem' }}
          value={resourceFilter}
          options={resourceOptions}
          onChange={(e) => setResourceFilter(e.value ?? '')}
          placeholder={t('appt_filterResource')}
        />

        <Dropdown
          style={{ minWidth: '12rem' }}
          value={clientFilter}
          options={clientOptions}
          onChange={(e) => setClientFilter(e.value ?? '')}
          placeholder={t('appt_filterClient')}
        />

        <Calendar
          style={{ minWidth: '10rem' }}
          value={fromDate}
          onChange={(e) => setFromDate(e.value as Date | null)}
          placeholder={t('appt_filterFrom')}
          showIcon
          dateFormat="yy-mm-dd"
        />

        <Calendar
          style={{ minWidth: '10rem' }}
          value={toDate}
          onChange={(e) => setToDate(e.value as Date | null)}
          placeholder={t('appt_filterTo')}
          showIcon
          dateFormat="yy-mm-dd"
        />

        {hasFilters && (
          <Button label="Clear" outlined size="small" severity="secondary" onClick={clearFilters} />
        )}
      </div>

      {/* Results count */}
      <p style={{ fontSize: '0.75rem', color: 'var(--text-color-secondary)', margin: 0 }}>
        {t('appt_showingCount', { count: String(filtered.length) })}
      </p>

      {/* Table */}
      {filtered.length === 0 ? (
        <EmptyState>{t('appt_noAppointments')}</EmptyState>
      ) : (
        <>
          <Menu model={items} popup ref={menuRef} />
          <DataTable
            value={filtered}
            dataKey="id"
            rowHover
            paginator
            rows={10}
            removableSort
            sortMode="multiple"
            emptyMessage={t('appt_noAppointments')}
            style={{ background: 'var(--surface-card)' }}
          >
            <Column field="startAt" header={t('appt_colStart')} sortable body={startBody} style={{ whiteSpace: 'nowrap' }} />
            <Column field="endAt" header={t('appt_colEnd')} sortable body={endBody} style={{ whiteSpace: 'nowrap' }} />
            <Column header={t('appt_colDuration')} body={(row: Appointment) => {
              const mins = Math.round((new Date(row.endAt).getTime() - new Date(row.startAt).getTime()) / 60_000);
              if (mins >= 60) {
                const h = Math.floor(mins / 60);
                const m = mins % 60;
                return m > 0 ? `${h}h ${m}m` : `${h}h`;
              }
              return `${mins}m`;
            }} />
            <Column field="primaryResourceId" header={t('appt_colResource')} body={(row: Appointment) => resourcesMap[row.primaryResourceId] ?? '—'} />
            <Column field="clientId" header={t('appt_colClient')} sortable body={clientBody} />
            <Column field="serviceIds" header={t('appt_colService')} body={serviceBody} />
            <Column field="status" header={t('appt_colStatus')} sortable body={statusBody} />
            <Column field="summary" header={t('appt_colSummary')} body={summaryBody} />
            <Column header={t('appt_colActions')} body={actionsBody} style={{ width: '4rem', textAlign: 'center' }} />
          </DataTable>
        </>
      )}
    </div>
  );
}
