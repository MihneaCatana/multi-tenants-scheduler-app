import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '../../lib/api';
import type { Resource, Service, Client } from '../../lib/types';

interface SchedulingData {
  resourcesQuery: ReturnType<typeof useQuery<{ resources: Resource[] }>>;
  servicesQuery: ReturnType<typeof useQuery<{ services: Service[] }>>;
  clientsQuery: ReturnType<typeof useQuery<{ clients: Client[] }>>;
  resourcesMap: Record<string, string>;
  resourcesById: Record<string, Resource>;
  servicesMap: Record<string, string>;
  servicesById: Record<string, Service>;
  clientsMap: Record<string, string>;
  clientsById: Record<string, Client>;
}

export function useSchedulingData(enabled = true): SchedulingData {
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

  const clientsQuery = useQuery({
    queryKey: ['clients'],
    queryFn: () => api.listClients(),
    enabled,
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

  const resourcesById = useMemo(() => {
    const map: Record<string, Resource> = {};
    if (resourcesQuery.data) {
      for (const r of resourcesQuery.data.resources) {
        map[r.id] = r;
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

  const servicesById = useMemo(() => {
    const map: Record<string, Service> = {};
    if (servicesQuery.data) {
      for (const s of servicesQuery.data.services) {
        map[s.id] = s;
      }
    }
    return map;
  }, [servicesQuery.data]);

  const clientsMap = useMemo(() => {
    const map: Record<string, string> = {};
    if (clientsQuery.data) {
      for (const c of clientsQuery.data.clients) {
        map[c.id] = c.name;
      }
    }
    return map;
  }, [clientsQuery.data]);

  const clientsById = useMemo(() => {
    const map: Record<string, Client> = {};
    if (clientsQuery.data) {
      for (const c of clientsQuery.data.clients) {
        map[c.id] = c;
      }
    }
    return map;
  }, [clientsQuery.data]);

  return {
    resourcesQuery,
    servicesQuery,
    clientsQuery,
    resourcesMap,
    resourcesById,
    servicesMap,
    servicesById,
    clientsMap,
    clientsById,
  };
}
