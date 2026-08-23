# Production Deployment Guide

Step-by-step guide for deploying Simi to a single VPS using Docker Compose.

---

## Prerequisites

- A VPS with **at least 2 vCPU / 4 GB RAM** (see [infrastructure.md](infrastructure.md) for sizing)
- A registered domain name (e.g. `simisolutions.com`)
- Docker + Docker Compose installed on the server
- SSH access to the server
- `git`, `curl`, and `openssl` installed

---

## 1. DNS Configuration

Simi uses subdomain-based multi-tenancy. Every tenant gets `tenantname.yourdomain.com`,
and the apex host (`yourdomain.com`) serves the platform admin console.

Add a **wildcard DNS record** pointing to your server's public IP:

```
Type    Name    Value
A       *       YOUR_SERVER_IP
A       @       YOUR_SERVER_IP
```

> **Why wildcard?** New tenants are provisioned without any DNS changes — the wildcard
> catches all subdomains. TTL of 300–600 seconds is fine.

Verify propagation:

```bash
dig +short acme-test.simisolutions.com  # should return your server IP
```

---

## 2. TLS Termination (Caddy)

Caddy is the recommended reverse proxy — it handles HTTPS automatically via
Let's Encrypt, including wildcard certificates for subdomain-based multi-tenancy.

### Install Caddy

```bash
sudo apt install -y debian-keyring debian-archive-keyring apt-transport-https
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | sudo gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' | sudo tee /etc/apt/sources.list.d/caddy-stable.list
sudo apt update && sudo apt install caddy
```

### Create a Caddyfile

```bash
sudo nano /etc/caddy/Caddyfile
```

```Caddyfile
# Replace simisolutions.com with your actual domain.
simisolutions.com, *.simisolutions.com {
    # TLS — Let's Encrypt handles this automatically.
    # Caddy obtains a wildcard cert via DNS-01 or cert-manager.

    # Security headers (HSTS, CSP). These complement the nginx headers inside Docker.
    header {
        Strict-Transport-Security "max-age=63072000; includeSubDomains; preload"
        X-Content-Type-Options "nosniff"
        -Server
    }

    # Frontend (nginx SPA server inside Docker, bound to localhost:8080).
    # Caddy terminates TLS and proxies plain HTTP to nginx.
    handle_path /v1/* {
        reverse_proxy localhost:3000
    }

    handle_path /health* {
        reverse_proxy localhost:3000
    }

    handle {
        reverse_proxy localhost:8080
    }
}
```

> **DNS-01 challenge:** For wildcard certificates, Caddy needs a DNS plugin
> (Cloudflare, Route53, etc.). See [Caddy DNS docs](https://caddyserver.com/docs/caddyfile/dns).
> Alternatively, skip the wildcard and use HTTP-01 — each new tenant will trigger
> a one-time cert request (slower but simpler).

### Start Caddy

```bash
sudo systemctl enable caddy
sudo systemctl start caddy
```

---

## 3. Clone & Configure

```bash
cd /opt
git clone <your-repo-url> simi
cd simi/backend
```

### Generate secrets

```bash
pnpm generate-secrets
```

This outputs all required keys. Copy them into your `.env`.

### Create the production `.env`

```bash
cp .env.production.example .env
```

Edit `.env` and fill in **every value**. Key differences from dev:

| Variable | Dev | Production |
|----------|-----|------------|
| `NODE_ENV` | `development` | `production` |
| `BASE_DOMAIN` | `simisolutions.localhost` | `simisolutions.com` |
| `TRUST_PROXY` | `false` | `1` (one hop behind Caddy) |
| `COOKIE_SECURE` | `false` | `true` |
| `DB_SSL` | `false` | `true` |
| `JWT_ALGORITHM` | `HS256` | `EdDSA` |
| `CORS_ORIGINS` | `http://localhost:5173` | `https://simisolutions.com,https://*.simisolutions.com` |

The app **refuses to start** in production without EdDSA keys, `COOKIE_SECURE=true`,
and `DB_SSL=true` — these are enforced at startup.

---

## 4. Build & Deploy

```bash
# Build the backend image.
docker compose -f docker-compose.yml build app

# Build the frontend (creates frontend/dist/ for nginx to serve).
cd ../frontend && npm run build && cd ../backend

# Start all services.
docker compose -f docker-compose.yml up -d
```

Verify all containers are healthy:

```bash
docker compose ps
```

All services should show `healthy` (Postgres) or `running` (others).

---

## 5. Run Migrations

```bash
docker compose -f docker-compose.yml exec app pnpm db:migrate
```

This migrates both the global schema and all tenant databases. See
[database-access.md](database-access.md) for details.

---

## 6. Seed the Platform Admin

```bash
docker compose -f docker-compose.yml exec app pnpm seed
```

Follow the prompts to create the initial platform admin account.

---

## 7. Verify

```bash
# Health check (liveness).
curl -s http://localhost:3000/health | jq .

# Readiness check (verifies DB connectivity).
curl -s http://localhost:3000/health/ready | jq .

# Test via the public domain (through Caddy + TLS).
curl -s https://simisolutions.com/health | jq .
```

---

## 8. Backups

Backups run automatically:
- **Global cluster:** `pg_dump` daily, 30-day retention
- **Tenant cluster:** `pg_dumpall` every 6 hours, 30-day retention
- All backups are **GPG-encrypted** at rest

Verify backups are working:

```bash
docker compose logs backup-global --since 24h | tail -5
docker compose logs backup-tenant --since 24h | tail -5
ls -la /var/lib/docker/volumes/simi_backups-global/_data/
ls -la /var/lib/docker/volumes/simi_backups-tenant/_data/
```

See [backups.md](backups.md) for restore procedures.

---

## Common Operations

```bash
# View logs.
docker compose logs -f app

# View tenant-specific logs (inside the container).
docker compose exec app ls logs/

# Restart a single service.
docker compose restart app

# Pull latest code and redeploy.
cd /opt/simi && git pull
cd backend && docker compose -f docker-compose.yml build app
docker compose -f docker-compose.yml up -d app

# Run migrations after a code update.
docker compose -f docker-compose.yml exec app pnpm db:migrate
```

---

## Troubleshooting

| Symptom | Check |
|---------|-------|
| App won't start | `docker compose logs app` — look for "refusing to start" messages |
| 502 from Caddy | Check `docker compose ps` — is the `app` container healthy? |
| Tenant subdomain 404 | Verify `BASE_DOMAIN` matches your domain; check DNS propagation |
| CORS errors in browser | Verify `CORS_ORIGINS` includes the exact origin (including subdomain) |
| DB connection refused | Check `DB_SSL` and `DB_SSL_CA` if using managed Postgres with private CA |
| Backup failures | `docker compose logs backup-tenant` — check `BACKUP_ENCRYPT_PASSPHRASE` is set |
