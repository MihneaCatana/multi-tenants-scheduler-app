import { Badge } from 'primereact/badge'
import { tenantContext } from '../lib/tenant'

export function TenantBadge() {
  const ctx = tenantContext()
  if (ctx.kind === 'platform') {
    return (
      <Badge value={ctx.kind === 'platform' ? 'apex · platform admin host' : ctx.subdomain + ' · tenant'} severity='info' />
    )
  }
  return (
    <Badge value={ctx.subdomain + ' · tenant'} severity='success' />
  )
}
