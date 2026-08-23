import { defineConfig, loadEnv } from 'vite';
import type { ProxyOptions } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath, URL } from 'node:url';
import type { ClientRequest, IncomingMessage } from 'node:http';

/**
 * Dev server + multi-tenant proxy.
 *
 * The backend resolves tenants purely from the request SUBDOMAIN against
 * BASE_DOMAIN (e.g. acme.simisolutions.localhost). To exercise multi-tenancy
 * end-to-end, this dev server runs on the same domain family so the frontend
 * origin mirrors the tenant the user is visiting:
 *   - simisolutions.localhost:5173   -> apex / platform admin
 *   - acme.simisolutions.localhost:5173 -> Acme tenant
 *
 * All versioned API routes live under `/v1/` on the backend. The refresh-token
 * cookie is scoped to `path=/v1/auth`. Proxying verbatim (not under `/api`)
 * keeps cookie semantics intact.
 *
 * The proxy rewrites the outgoing `Host` header to mirror the inbound subdomain,
 * so the backend's tenant resolver sees e.g. `acme.simisolutions.localhost`
 * instead of `localhost:3000`.
 */
function rewriteHost(incomingHost: string | undefined, backendPort: number): string {
  // Incoming host looks like `acme.simisolutions.localhost:5173`. Strip the port
  // (the backend strips it too) and re-append the backend port so the value is
  // unambiguous. The backend's getSubdomain() lowercases + strips trailing dots.
  const withoutPort = (incomingHost ?? '').split(':')[0]!.replace(/\.+$/, '');
  return withoutPort ? `${withoutPort}:${backendPort}` : `localhost:${backendPort}`;
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  const backendPort = Number(env.VITE_BACKEND_PORT ?? 3000);
  const frontendPort = Number(env.VITE_PORT ?? 5173);

  // Shared proxy options: target the backend and rewrite Host for tenant resolution.
  const proxyOptions: ProxyOptions = {
    target: `http://localhost:${backendPort}`,
    changeOrigin: false,
    configure: (proxy) => {
      proxy.on('proxyReq', (proxyReq: ClientRequest, req: IncomingMessage) => {
        proxyReq.setHeader('host', rewriteHost(req.headers.host, backendPort));
      });
    },
  };

  return {
    plugins: [react()],
    resolve: {
      alias: {
        '@': fileURLToPath(new URL('./src', import.meta.url)),
      },
    },
    build: {
      base: '/',
      sourcemap: false,
      rollupOptions: {
        output: {
          manualChunks: {
            vendor: ['react', 'react-dom', 'react-router-dom'],
            prime: ['primereact', 'primeicons'],
            charts: ['recharts'],
            scheduling: ['@schedule-x/calendar', '@schedule-x/theme-default'],
          },
        },
      },
    },
    server: {
      // Bind all interfaces so *.simisolutions.localhost reaches the dev server.
      host: true,
      port: frontendPort,
      strictPort: true,
      proxy: {
        // Each backend route prefix proxied verbatim — see file header for why.
        // All share identical options (target + Host rewrite for tenancy).
        '/v1': { ...proxyOptions },
        '/health': { ...proxyOptions },
      },
    },
  };
});
