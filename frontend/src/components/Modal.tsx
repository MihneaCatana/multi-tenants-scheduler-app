import { type ReactNode } from 'react'
import { Dialog } from 'primereact/dialog'

const SIZE_WIDTH: Record<string, string> = {
  sm: '30vw',
  md: '40vw',
  lg: '55vw',
  xl: '70vw',
}

export function Modal({
  open,
  title,
  onClose,
  children,
  footer,
  size = 'md',
}: {
  open: boolean
  title: string
  onClose: () => void
  children: ReactNode
  footer?: ReactNode
  size?: 'sm' | 'md' | 'lg' | 'xl'
}) {
  return (
    <Dialog
      header={title}
      visible={open}
      onHide={onClose}
      footer={footer ? () => <div style={{ display: 'flex', gap: '0.5rem', justifyContent: 'flex-end' }}>{footer}</div> : undefined}
      style={{ width: SIZE_WIDTH[size] ?? SIZE_WIDTH.md, maxWidth: '90vw' }}
      maximizable={false}
      draggable={false}
      resizable={false}
    >
      <div style={{ overflowY: 'auto' }}>{children}</div>
    </Dialog>
  )
}
