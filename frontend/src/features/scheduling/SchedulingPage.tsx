import { useState, useCallback, useRef } from 'react'
import { AppLayout } from '../../components/AppLayout'
import { Button } from 'primereact/button'
import { TabView, TabPanel } from 'primereact/tabview'
import { EmptyState } from '../../components/EmptyState'
import { CreateAppointmentForm } from '../calendar/CreateAppointmentForm'
import { AppointmentsTab } from './tabs/AppointmentsTab'
import { ResourcesTab } from './tabs/ResourcesTab'
import { ServicesTab } from './tabs/ServicesTab'
import { CalendarTab } from './tabs/CalendarTab'
import { useSchedulingData } from './hooks'
import { useFlag } from '../flags/hooks'
import { FeatureFlag } from '../../lib/flags'
import { useI18n } from '../../lib/i18n'

export function SchedulingPage() {
  const { t } = useI18n()
  const enabled = useFlag(FeatureFlag.APPOINTMENTS)
  const [activeTab, setActiveTab] = useState(0)
  const [creating, setCreating] = useState(false)
  const [defaultStartAt, setDefaultStartAt] = useState<string | undefined>()
  const resourcesRef = useRef<{ openCreate: () => void }>(null)
  const servicesRef = useRef<{ openCreate: () => void }>(null)
  const data = useSchedulingData(enabled)

  const handleCreateTimeSlot = useCallback((date: Date) => {
    setDefaultStartAt(date.toISOString())
    setCreating(true)
  }, [])

  const handleClose = useCallback(() => {
    setCreating(false)
    setDefaultStartAt(undefined)
  }, [])

  const handleAdd = useCallback(() => {
    if (activeTab === 0 || activeTab === 1) {
      setDefaultStartAt(undefined)
      setCreating(true)
    } else if (activeTab === 2) {
      resourcesRef.current?.openCreate()
    } else if (activeTab === 3) {
      servicesRef.current?.openCreate()
    }
  }, [activeTab])

  if (!enabled) {
    return (
      <AppLayout title={t('sched_title')}>
        <EmptyState>{t('sched_unavailable')}</EmptyState>
      </AppLayout>
    )
  }

  return (
    <AppLayout
      title={t('sched_title')}
      actions={
        <Button icon="pi pi-plus" label={t('sched_add')} size="small" onClick={handleAdd} />
      }
    >
      <TabView activeIndex={activeTab} onTabChange={(e) => setActiveTab(e.index)}>
        <TabPanel header={t('sched_tabAppointments')}>
          <AppointmentsTab
            resourcesMap={data.resourcesMap}
            servicesMap={data.servicesMap}
            clientsMap={data.clientsMap}
            resourcesById={data.resourcesById}
            servicesById={data.servicesById}
            clientsById={data.clientsById}
          />
        </TabPanel>
        <TabPanel header={t('sched_tabCalendar')}>
          <CalendarTab
            resourcesMap={data.resourcesMap}
            servicesMap={data.servicesMap}
            clientsMap={data.clientsMap}
            resourcesById={data.resourcesById}
            servicesById={data.servicesById}
            clientsById={data.clientsById}
            onCreateTimeSlot={handleCreateTimeSlot}
          />
        </TabPanel>
        <TabPanel header={t('sched_tabResources')}>
          <ResourcesTab ref={resourcesRef} />
        </TabPanel>
        <TabPanel header={t('sched_tabServices')}>
          <ServicesTab ref={servicesRef} />
        </TabPanel>
      </TabView>

      <CreateAppointmentForm
        open={creating}
        onClose={handleClose}
        defaultStartAt={defaultStartAt}
      />
    </AppLayout>
  )
}
