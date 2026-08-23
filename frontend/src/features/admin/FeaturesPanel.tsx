import { useEffect, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { DataTable } from 'primereact/datatable';
import { Column } from 'primereact/column';
import { Button } from 'primereact/button';
import { Badge } from 'primereact/badge';
import { Message } from 'primereact/message';
import { Menu } from 'primereact/menu';
import type { MenuItem } from 'primereact/menuitem';
import { api, ApiError } from '../../lib/api';
import { EmptyState } from '../../components/EmptyState';
import { Spinner } from '../../components/Spinner';
import type { FeatureDef, ResolvedFlag, TenantSummary } from '../../lib/types';

/**
 * Platform-admin feature-flag management (apex host only).
 *
 * Two views:
 *  1. Catalog overview — read-only list of all flags (code-owned).
 *  2. Per-tenant management — pick a tenant, toggle its overrides inline.
 *
 * A flag with no override inherits the catalog default; the row shows the
 * current resolved value plus the default as a hint. Save sends only changed
 * toggles.
 */
export function FeaturesPanel() {
  const qc = useQueryClient();
  const [selectedTenantId, setSelectedTenantId] = useState<string | null>(null);

  const tenantsQ = useQuery({
    queryKey: ['tenants'],
    queryFn: () => api.listTenants({ limit: 100 }),
  });
  const catalogQ = useQuery({
    queryKey: ['features'],
    queryFn: () => api.listFeatures(),
  });

  const flagsQ = useQuery({
    queryKey: ['tenants', selectedTenantId, 'flags'],
    queryFn: () => api.getTenantFlags(selectedTenantId!),
    enabled: !!selectedTenantId,
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, body }: { id: string; body: { flags: { key: string; enabled: boolean }[] } }) =>
      api.updateTenantFlags(id, body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['tenants', selectedTenantId, 'flags'] });
    },
  });

  const selectedTenant = tenantsQ.data?.tenants.find((t) => t.id === selectedTenantId);

  const sectionHeaderStyle: React.CSSProperties = {
    margin: '0 0 0.75rem',
    fontSize: '0.75rem',
    fontWeight: 600,
    textTransform: 'uppercase',
    letterSpacing: '0.06em',
    color: 'var(--text-color-secondary)',
  };

  return (
    <>
      <section style={{ marginBottom: '2rem' }}>
        <h2 style={sectionHeaderStyle}>Catalog</h2>
        {catalogQ.isLoading ? (
          <div style={{ display: 'flex', justifyContent: 'center', padding: '2rem 0' }}>
            <Spinner />
          </div>
        ) : catalogQ.error ? (
          <ErrorNote err={catalogQ.error} />
        ) : (
          <CatalogTable features={catalogQ.data?.features ?? []} />
        )}
      </section>

      <section>
        <h2 style={sectionHeaderStyle}>Per-tenant overrides</h2>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.75rem' }}>
          <label
            style={{
              fontSize: '0.875rem',
              fontWeight: 500,
              color: 'var(--text-color)',
            }}
          >
            Tenant
          </label>
          <select
            style={{
              height: '2rem',
              width: '100%',
              maxWidth: '20rem',
              borderRadius: 'var(--content-border-radius)',
              border: '1px solid var(--surface-border)',
              backgroundColor: 'var(--surface-card)',
              color: 'var(--text-color)',
              padding: '0 0.5rem',
              fontSize: '0.875rem',
              cursor: 'pointer',
            }}
            value={selectedTenantId ?? ''}
            onChange={(e) => setSelectedTenantId(e.target.value || null)}
          >
            <option value="">— select a tenant —</option>
            {(tenantsQ.data?.tenants ?? []).map((t) => (
              <option key={t.id} value={t.id}>
                {t.name} ({t.subdomain})
              </option>
            ))}
          </select>
        </div>

        {!selectedTenantId ? (
          <p style={{ fontSize: '0.875rem', color: 'var(--text-color-secondary)' }}>
            Select a tenant to manage its flags.
          </p>
        ) : flagsQ.isLoading ? (
          <div style={{ display: 'flex', justifyContent: 'center', padding: '2rem 0' }}>
            <Spinner />
          </div>
        ) : flagsQ.error ? (
          <ErrorNote err={flagsQ.error} />
        ) : (
          <TenantFlagsTable
            tenant={selectedTenant}
            flags={flagsQ.data?.flags ?? []}
            catalog={catalogQ.data?.features ?? []}
            saving={updateMutation.isPending}
            onSave={(changes) =>
              updateMutation.mutate({ id: selectedTenantId, body: { flags: changes } })
            }
            error={updateMutation.error}
          />
        )}
      </section>
    </>
  );
}

function CatalogTable({ features }: { features: FeatureDef[] }) {
  if (features.length === 0) {
    return <EmptyState>No flags defined.</EmptyState>;
  }
  return (
    <div
      style={{
        backgroundColor: 'var(--surface-card)',
        border: '1px solid var(--surface-border)',
        borderRadius: 'var(--content-border-radius)',
        overflowX: 'auto',
      }}
    >
      <DataTable
        value={features}
        dataKey="key"
        rowHover
        responsiveLayout="scroll"
        style={{ fontSize: '0.875rem' }}
      >
        <Column
          field="key"
          header="Key"
          sortable
          body={(row: FeatureDef) => (
            <span
              style={{
                fontFamily: 'monospace',
                fontSize: '0.75rem',
                color: 'var(--text-color-secondary)',
              }}
            >
              {row.key}
            </span>
          )}
        />
        <Column
          field="label"
          header="Label"
          sortable
          body={(row: FeatureDef) => (
            <span style={{ fontWeight: 600, color: 'var(--text-color)' }}>{row.label}</span>
          )}
        />
        <Column
          field="description"
          header="Description"
          body={(row: FeatureDef) => (
            <span style={{ color: 'var(--text-color-secondary)' }}>{row.description}</span>
          )}
        />
        <Column
          field="enabled"
          header="Default"
          sortable
          body={(row: FeatureDef) => (
            <Badge
              value={row.enabled ? 'on' : 'off'}
              severity={row.enabled ? 'success' : undefined}
            />
          )}
        />
      </DataTable>
    </div>
  );
}

function TenantFlagsTable({
  tenant,
  flags,
  catalog,
  saving,
  onSave,
  error,
}: {
  tenant?: TenantSummary;
  flags: ResolvedFlag[];
  catalog: FeatureDef[];
  saving: boolean;
  onSave: (changes: { key: string; enabled: boolean }[]) => void;
  error: unknown;
}) {
  // Local draft of the resolved values; only divergences from the current
  // resolved state are sent on save.
  const defaults = new Map(catalog.map((c) => [c.key, c.enabled]));
  const current = new Map(flags.map((f) => [f.key, f.enabled]));
  const [draft, setDraft] = useState<Record<string, boolean>>({});

  // Per-row actions menu. A single Menu instance is reused; the active row is
  // tracked so the toggle handler knows which flag to flip.
  const menuRef = useRef<Menu>(null);
  const [activeRow, setActiveRow] = useState<ResolvedFlag | null>(null);

  // Reset draft when the tenant or its flags change.
  useEffect(() => {
    setDraft({});
  }, [tenant?.id, flags]);

  const effective = (key: string): boolean => draft[key] ?? current.get(key) ?? false;
  const dirty = Object.entries(draft).filter(([k, v]) => (current.get(k) ?? false) !== v);

  const openActions = (e: React.MouseEvent, row: ResolvedFlag) => {
    setActiveRow(row);
    menuRef.current?.toggle(e);
  };

  const items: MenuItem[] = [
    {
      label: 'Toggle',
      icon: 'pi pi-toggle-left',
      command: () => {
        if (!activeRow) return;
        const on = effective(activeRow.key);
        setDraft((d) => ({ ...d, [activeRow.key]: !on }));
      },
    },
  ];

  return (
    <>
      <div
        style={{
          backgroundColor: 'var(--surface-card)',
          border: '1px solid var(--surface-border)',
          borderRadius: 'var(--content-border-radius)',
          overflowX: 'auto',
        }}
      >
        <Menu model={items} popup ref={menuRef} />
        <DataTable
          value={flags}
          dataKey="key"
          rowHover
          responsiveLayout="scroll"
          style={{ fontSize: '0.875rem' }}
        >
          <Column
            field="key"
            header="Flag"
            sortable
            body={(row: ResolvedFlag) => (
              <span style={{ fontWeight: 600, color: 'var(--text-color)' }}>
                {labelFor(catalog, row.key)}
              </span>
            )}
          />
          <Column
            field="resolved"
            header="Resolved"
            body={(row: ResolvedFlag) => {
              const on = effective(row.key);
              return (
                <Badge value={on ? 'on' : 'off'} severity={on ? 'success' : undefined} />
              );
            }}
          />
          <Column
            field="default"
            header="Default"
            body={(row: ResolvedFlag) => {
              const def = defaults.get(row.key) ?? false;
              return (
                <span style={{ fontSize: '0.75rem', color: 'var(--text-color-secondary)' }}>
                  {def ? 'on' : 'off'}
                </span>
              );
            }}
          />
          <Column
            header="Actions"
            body={(row: ResolvedFlag) => (
              <Button
                type="button"
                icon="pi pi-ellipsis-v"
                text
                rounded
                size="small"
                aria-label="Toggle"
                onClick={(e) => openActions(e, row)}
              />
            )}
            style={{ width: '4rem', textAlign: 'center' }}
          />
        </DataTable>
      </div>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'flex-end',
          gap: '0.75rem',
          borderTop: '1px solid var(--surface-border)',
          padding: '0.75rem 1rem',
        }}
      >
        {error ? (
          <span style={{ fontSize: '0.75rem', color: 'var(--primary-color)' }}>
            {error instanceof ApiError ? error.message : 'Save failed'}
          </span>
        ) : null}
        <Button
          type="button"
          size="small"
          disabled={saving || dirty.length === 0}
          label={saving ? 'Saving…' : `Save${dirty.length > 0 ? ` (${dirty.length})` : ''}`}
          onClick={() => onSave(dirty.map(([key, enabled]) => ({ key, enabled })))}
        />
      </div>
    </>
  );
}

function labelFor(catalog: FeatureDef[], key: string): string {
  return catalog.find((c) => c.key === key)?.label ?? key;
}

function ErrorNote({ err }: { err: unknown }) {
  const msg = err instanceof ApiError ? err.message : 'Could not load data.';
  return <Message severity="error" text={msg} />;
}
