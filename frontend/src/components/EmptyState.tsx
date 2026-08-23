import { type ReactNode } from 'react'

export function EmptyState({ children }: { children: ReactNode }) {
  return (
    <div className="empty-state">
      <i className="pi pi-inbox" />
      {children}
    </div>
  )
}
