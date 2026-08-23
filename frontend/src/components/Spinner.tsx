import { ProgressSpinner } from 'primereact/progressspinner'

export function Spinner({ size = '2rem' }: { size?: string }) {
  return <ProgressSpinner style={{ width: size, height: size }} strokeWidth="3" />
}

export function FullPageSpinner() {
  return (
    <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', padding: '4rem 1rem' }}>
      <Spinner size="3rem" />
    </div>
  )
}
