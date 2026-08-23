import 'temporal-polyfill/global';
import { useEffect, useRef, useCallback, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  createCalendar,
  createViewWeek,
  createViewDay,
  createViewMonthGrid,
} from '@schedule-x/calendar';
import type {
  CalendarApp,
  CalendarEventExternal,
  CalendarConfig,
} from '@schedule-x/calendar';
import { Temporal } from 'temporal-polyfill';
import '@schedule-x/theme-default/dist/index.css';

import { api, ApiError } from '../../../lib/api';
import { useI18n } from '../../../lib/i18n';
import { useQueryClient } from '@tanstack/react-query';
import type { AppointmentStatus, Resource, Service, Client } from '../../../lib/types';

/* -------------------------------------------------------------------------- */
/*  Types                                                                      */
/* -------------------------------------------------------------------------- */

interface CalendarTabProps {
  resourcesMap: Record<string, string>;
  servicesMap: Record<string, string>;
  clientsMap: Record<string, string>;
  resourcesById: Record<string, Resource>;
  servicesById: Record<string, Service>;
  clientsById: Record<string, Client>;
  /** Called when the user clicks an empty time slot or date cell to create an appointment. */
  onCreateTimeSlot?: (date: Date) => void;
}

/* -------------------------------------------------------------------------- */
/*  Status → calendarId mapping for colouring                                 */
/* -------------------------------------------------------------------------- */

const STATUS_CALENDAR_MAP: Record<AppointmentStatus, string> = {
  requested: 'requested',
  confirmed: 'confirmed',
  checked_in: 'confirmed',
  in_progress: 'in-progress',
  completed: 'completed',
  cancelled: 'cancelled',
  no_show: 'cancelled',
};

/* -------------------------------------------------------------------------- */
/*  Calendar colours per status (light + dark theme)                          */
/* -------------------------------------------------------------------------- */

const CALENDAR_COLORS: Record<string, {
  colorName: string;
  lightColors: { main: string; container: string; onContainer: string };
  darkColors: { main: string; container: string; onContainer: string };
}> = {
  requested: {
    colorName: 'requested',
    lightColors: { main: '#f59e0b', container: '#fef3c7', onContainer: '#78350f' },
    darkColors: { main: '#fbbf24', container: '#451a03', onContainer: '#fde68a' },
  },
  confirmed: {
    colorName: 'confirmed',
    lightColors: { main: '#3b82f6', container: '#dbeafe', onContainer: '#1e3a5f' },
    darkColors: { main: '#60a5fa', container: '#1e3a5f', onContainer: '#dbeafe' },
  },
  'in-progress': {
    colorName: 'in-progress',
    lightColors: { main: '#8b5cf6', container: '#ede9fe', onContainer: '#3b0764' },
    darkColors: { main: '#a78bfa', container: '#3b0764', onContainer: '#ede9fe' },
  },
  completed: {
    colorName: 'completed',
    lightColors: { main: '#10b981', container: '#d1fae5', onContainer: '#064e3b' },
    darkColors: { main: '#34d399', container: '#064e3b', onContainer: '#d1fae5' },
  },
  cancelled: {
    colorName: 'cancelled',
    lightColors: { main: '#ef4444', container: '#fee2e2', onContainer: '#7f1d1d' },
    darkColors: { main: '#f87171', container: '#7f1d1d', onContainer: '#fee2e2' },
  },
};

/* -------------------------------------------------------------------------- */
/*  Helpers                                                                    */
/* -------------------------------------------------------------------------- */

/** Convert an ISO date-time string to a Temporal.ZonedDateTime in UTC. */
function toZonedDateTime(isoString: string): Temporal.ZonedDateTime {
  const jsDate = new Date(isoString);
  return Temporal.ZonedDateTime.from({
    year: jsDate.getUTCFullYear(),
    month: jsDate.getUTCMonth() + 1,
    day: jsDate.getUTCDate(),
    hour: jsDate.getUTCHours(),
    minute: jsDate.getUTCMinutes(),
    second: jsDate.getUTCSeconds(),
    timeZone: 'UTC',
  });
}

/** Snap a pixel delta to the nearest grid interval (in minutes). */
const DRAG_SNAP_MINUTES = 15;

/**
 * Return a DOMRect for the time-grid body of the currently rendered schedule-x
 * view. Falls back to null when not in a time-grid view (e.g. month grid).
 */
function getTimeGridRect(container: HTMLElement): DOMRect | null {
  const grid = container.querySelector('.sx__time-grid-body');
  if (!grid) return null;
  return grid.getBoundingClientRect();
}

/** Calculate how many minutes a vertical pixel offset represents. */
function minutesPerPixel(gridRect: DOMRect): number {
  const totalMinutes = 24 * 60; // 00:00–24:00
  return totalMinutes / gridRect.height;
}

/* -------------------------------------------------------------------------- */
/*  CalendarTab                                                                */
/* -------------------------------------------------------------------------- */

export function CalendarTab({
  clientsMap,
  servicesMap,
  onCreateTimeSlot,
}: CalendarTabProps) {
  const { t } = useI18n();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const onCreateTimeSlotRef = useRef(onCreateTimeSlot);
  onCreateTimeSlotRef.current = onCreateTimeSlot;

  // Keep lookup maps in refs so callbacks always see fresh data without
  // recreating the calendar.
  const clientsRef = useRef(clientsMap);
  clientsRef.current = clientsMap;
  const servicesRef = useRef(servicesMap);
  servicesRef.current = servicesMap;

  const containerRef = useRef<HTMLDivElement>(null);
  const calendarRef = useRef<CalendarApp | null>(null);

  // ---- callbacks (stable — always read from refs) ----
  const fetchEvents = useCallback(async (range: { start: Temporal.ZonedDateTime; end: Temporal.ZonedDateTime }): Promise<CalendarEventExternal[]> => {
    const from = range.start.toInstant().toString();
    const to = range.end.toInstant().toString();
    const data = await api.listAppointments({ from, to });

    return data.appointments.map((a) => {
      const primaryServiceName = a.serviceIds?.length > 0
        ? (servicesRef.current[a.serviceIds[0]!] ?? '')
        : '';
      return {
        id: a.id,
        title: [
          a.clientId
            ? (clientsRef.current[a.clientId] ?? t('cal_walkIn'))
            : t('cal_walkIn'),
          primaryServiceName,
        ].filter(Boolean).join(' — '),
        start: toZonedDateTime(a.startAt),
        end: toZonedDateTime(a.endAt),
        calendarId: STATUS_CALENDAR_MAP[a.status] ?? 'confirmed',
      };
    });
  }, [t]);

  const onEventClick = useCallback((event: CalendarEventExternal) => {
    navigate(`/workspace/calendar/${event.id}`);
  }, [navigate]);

  const onClickDateTime = useCallback((dateTime: Temporal.ZonedDateTime) => {
    const snapped = dateTime.round({ smallestUnit: 'hour', roundingMode: 'floor' });
    const jsDate = new Date(snapped.toInstant().epochMilliseconds);
    onCreateTimeSlotRef.current?.(jsDate);
  }, []);

  const onClickDate = useCallback((date: Temporal.PlainDate) => {
    const jsDate = new Date(date.year, date.month - 1, date.day, 9, 0);
    onCreateTimeSlotRef.current?.(jsDate);
  }, []);

  // ---- create / render / destroy lifecycle ----
  useEffect(() => {
    const el = containerRef.current;
    if (!el || el.children.length > 0) return; // already rendered

    const now = new Date();
    const calendarConfig: CalendarConfig = {
      views: [createViewWeek(), createViewDay(), createViewMonthGrid()],
      selectedDate: Temporal.PlainDate.from({
        year: now.getFullYear(),
        month: now.getMonth() + 1,
        day: now.getDate(),
      }),
      calendars: CALENDAR_COLORS,
      dayBoundaries: { start: '00:00', end: '24:00' },
      monthGridOptions: { nEventsPerDay: 3 },
      weekOptions: {
        gridStep: 60,
        timeAxisFormatOptions: { hour: '2-digit', minute: '2-digit', hour12: false },
      },
      callbacks: {
        fetchEvents,
        onEventClick,
        onClickDateTime,
        onClickDate,
      },
    };

    const app = createCalendar(calendarConfig);
    calendarRef.current = app;
    app.render(el);

    return () => {
      app.destroy();
      calendarRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ---- dark-mode sync ----
  useEffect(() => {
    const app = calendarRef.current;
    if (!app) return;

    const applyTheme = () => {
      const isDark = document.documentElement.classList.contains('dark');
      app.setTheme(isDark ? 'dark' : 'light');
    };
    applyTheme();

    const observer = new MutationObserver(applyTheme);
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });
    return () => observer.disconnect();
  }, []);

  // ---- drag-and-drop reschedule ----
  const [dragError, setDragError] = useState<string | null>(null);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    let dragging = false;
    let dragEventEl: HTMLElement | null = null;
    let dragEventId: string | null = null;
    let dragStartY = 0;
    let dragOriginalTransform = '';

    const handlePointerDown = (e: PointerEvent) => {
      const target = e.target as HTMLElement;
      const eventEl = target.closest('.sx__event') as HTMLElement | null;
      if (!eventEl) return;

      // Only enable drag in time-grid views (week / day)
      const gridRect = getTimeGridRect(container);
      if (!gridRect) return;

      // Only allow drag on confirmed and checked_in appointments
      dragEventId = eventEl.getAttribute('data-event-id');
      if (!dragEventId) return;

      dragging = true;
      dragEventEl = eventEl;
      dragStartY = e.clientY;
      dragOriginalTransform = eventEl.style.transform;
      eventEl.style.transform = 'scale(1.04)';
      eventEl.style.zIndex = '50';
      eventEl.style.opacity = '0.85';
      eventEl.setPointerCapture(e.pointerId);
      setDragError(null);
    };

    const handlePointerMove = (e: PointerEvent) => {
      if (!dragging || !dragEventEl) return;

      const gridRect = getTimeGridRect(container);
      if (!gridRect) return;

      const deltaY = e.clientY - dragStartY;
      const mpp = minutesPerPixel(gridRect);
      const deltaMinutes = deltaY * mpp;
      // Snap to 15-min intervals
      const snappedDelta = Math.round(deltaMinutes / DRAG_SNAP_MINUTES) * DRAG_SNAP_MINUTES;
      const pixelDelta = snappedDelta / mpp;

      dragEventEl.style.transform = `translateY(${pixelDelta}px) scale(1.04)`;
    };

    const handlePointerUp = async (e: PointerEvent) => {
      if (!dragging || !dragEventEl || !dragEventId) return;
      dragging = false;

      const gridRect = getTimeGridRect(container);
      if (!gridRect) {
        resetDragEl();
        return;
      }

      const deltaY = e.clientY - dragStartY;
      const mpp = minutesPerPixel(gridRect);
      const deltaMinutes = deltaY * mpp;
      const snappedDelta = Math.round(deltaMinutes / DRAG_SNAP_MINUTES) * DRAG_SNAP_MINUTES;

      resetDragEl();

      // If no meaningful change, do nothing
      if (Math.abs(snappedDelta) < DRAG_SNAP_MINUTES) return;

      // Calculate new start time from the existing event
      const app = calendarRef.current;
      if (!app) return;

      const existing = app.events.get(dragEventId);
      if (!existing) return;

      const start = existing.start as Temporal.ZonedDateTime;
      const end = existing.end as Temporal.ZonedDateTime;
      const durationMinutes = end.since(start).total('minutes');

      const newStart = start.add({ minutes: snappedDelta });
      const newStartISO = newStart.toInstant().toString();

      try {
        await api.patchAppointment(dragEventId, { action: 'reschedule', startAt: newStartISO });
        // Update the event locally in the calendar
        const newEnd = newStart.add({ minutes: durationMinutes });
        app.events.update({ ...existing, start: newStart, end: newEnd });
        // Invalidate appointments cache so the list tab stays in sync
        qc.invalidateQueries({ queryKey: ['appointments'] });
      } catch (err) {
        if (err instanceof ApiError) {
          setDragError(err.message);
        } else {
          setDragError(t('cal_dragError'));
        }
      }
    };

    const resetDragEl = () => {
      if (dragEventEl) {
        dragEventEl.style.transform = dragOriginalTransform;
        dragEventEl.style.zIndex = '';
        dragEventEl.style.opacity = '';
      }
      dragEventEl = null;
      dragEventId = null;
    };

    container.addEventListener('pointerdown', handlePointerDown);
    container.addEventListener('pointermove', handlePointerMove);
    container.addEventListener('pointerup', handlePointerUp);
    return () => {
      container.removeEventListener('pointerdown', handlePointerDown);
      container.removeEventListener('pointermove', handlePointerMove);
      container.removeEventListener('pointerup', handlePointerUp);
    };
  }, [qc, t]);

  // Auto-dismiss drag error after 4s
  useEffect(() => {
    if (!dragError) return;
    const timer = setTimeout(() => setDragError(null), 4000);
    return () => clearTimeout(timer);
  }, [dragError]);

  return (
    <div>
      {dragError && (
        <div className="mb-2 rounded-md border border-destructive/50 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {dragError}
        </div>
      )}
      <div ref={containerRef} />
    </div>
  );
}
