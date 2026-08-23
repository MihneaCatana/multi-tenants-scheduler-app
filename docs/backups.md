# Backups

How the Simi platform's automated backup system works, and how to inspect, extract,
and restore backups.

> **Related docs:** [Infrastructure](./infrastructure.md) ·
> [Multi-Tenancy](./multi-tenancy.md) ·
> [Database Access](./database-access.md) ·
> [Modules](./modules.md)

---

## Overview

Simi uses **sidecar backup containers** that run alongside the PostgreSQL instances in
Docker Compose. Each cluster (global and tenant) has its own backup service that runs
`pg_dump` on a daily schedule and stores encrypted archives in a Docker volume.

```
  ┌──────────────────┐          ┌──────────────────┐
  │ postgres-global  │──────────▶│ backup-global     │
  │ simi_global       │  daily   │ pg_dump @daily    │──▶ backups-global/
  └──────────────────┘          │ GPG-encrypted     │     volume
                                └──────────────────┘

  ┌──────────────────┐          ┌──────────────────┐
  │ postgres-tenant  │──────────▶│ backup-tenant     │
  │ tenant_*         │  daily   │ pg_dumpall @daily │──▶ backups-tenant/
  └──────────────────┘          │ GPG-encrypted     │     volume
                                └──────────────────┘
```

---

## Backup Configuration

### Global Cluster Backup

| Setting | Value |
|---------|-------|
| **Service** | `backup-global` |
| **Image** | `prodrigestivill/postgres-backup-local:16` |
| **Dump tool** | `pg_dump` |
| **Options** | `-Z6 --schema=public` (gzip level 6, public schema only) |
| **Schedule** | `@daily` (once per day at midnight UTC) |
| **Retention** | 30 days **or** 90 files (whichever comes first) |
| **Storage** | `backups-global` Docker volume at `/backups` |
| **Encryption** | GPG with `BACKUP_ENCRYPT_PASSPHRASE` |

### Tenant Cluster Backup

| Setting | Value |
|---------|-------|
| **Service** | `backup-tenant` |
| **Image** | `prodrigestivill/postgres-backup-local:16` |
| **Dump tool** | `pg_dumpall` (all databases in one pass) |
| **Options** | `-Z6` (gzip level 6, all databases + roles) |
| **Schedule** | `@daily` (once per day at midnight UTC) |
| **Retention** | 30 days **or** 90 files (whichever comes first) |
| **Storage** | `backups-tenant` Docker volume at `/backups` |
| **Encryption** | GPG with `BACKUP_ENCRYPT_PASSPHRASE` |

### Why pg_dump vs pg_dumpall?

- **Global cluster:** Uses `pg_dump` with `--schema=public` because the global
  cluster only has one database (`simi_global`). This produces a single
  database-specific dump.

- **Tenant cluster:** Uses `pg_dumpall` because the tenant cluster hosts **multiple
  databases** (one per tenant + the template). `pg_dumpall` backs up all databases,
  roles, and tablespaces in a single pass — no need to enumerate tenants.

---

## GPG Encryption

Backups are encrypted at rest using GPG symmetric encryption. The passphrase is set via
the `BACKUP_ENCRYPT_PASSPHRASE` environment variable.

- **Encrypted files** have a `.gpg` extension and are stored in the backup volume.
- **Decryption** requires the same passphrase.
- If the passphrase is empty in `.env`, backups are stored **unencrypted** (dev-only).

> ⚠️ **Production:** Always set a strong `BACKUP_ENCRYPT_PASSPHRASE`. Backups contain
> all tenant data and are only as secure as this passphrase.

---

## Backup File Naming

Backup files follow the pattern:

```
<db_name>_<YYYY-MM-DD>_<HHmmss>.sql.gz.gpg
```

Examples:
- Global: `simi_global_2026-07-14_000001.sql.gz.gpg`
- Tenant: `all_databases_2026-07-14_000001.sql.gz.gpg`

---

## Monitoring Backup Status

### Check Backup Container Logs

```bash
# Global cluster backups
docker compose logs backup-global --since 24h

# Tenant cluster backups
docker compose logs backup-tenant --since 24h
```

### Check Last Backup Timestamp

```bash
# List backup files in the volume
docker compose exec backup-global ls -la /backups/
docker compose exec backup-tenant ls -la /backups/
```

---

## Inspecting and Extracting Backups

### Copy a Backup Out of the Container

```bash
# Find the backup volume name
docker volume inspect project-simi_backups-global --format '{{.Mountpoint}}'
docker volume inspect project-simi_backups-tenant --format '{{.Mountpoint}}'

# Or copy from the running container
docker cp simi-backup-global:/backups/<filename> ./backup.sql.gz.gpg
```

### Decrypt a Backup

```bash
gpg --decrypt --batch --passphrase "YOUR_BACKUP_ENCRYPT_PASSPHRASE" \
  backup.sql.gz.gpg > backup.sql.gz
```

### Decompress and Inspect

```bash
gunzip backup.sql.gz
# Now backup.sql contains the full SQL dump
head -100 backup.sql  # inspect the first 100 lines
```

---

## Restoring from Backup

### Restore the Global Database

⚠️ **This overwrites all data in `simi_global`.**

```bash
# 1. Stop the app to prevent writes during restore
docker compose stop app

# 2. Copy, decrypt, and decompress the backup
docker cp simi-backup-global:/backups/simi_global_2026-07-14_000001.sql.gz.gpg ./backup.sql.gz.gpg
gpg --decrypt --batch --passphrase "YOUR_BACKUP_ENCRYPT_PASSPHRASE" \
  backup.sql.gz.gpg > backup.sql.gz
gunzip backup.sql.gz

# 3. Restore into the global database
docker compose exec -T postgres-global \
  psql -U simi_global_admin -d simi_global < backup.sql

# 4. Restart the app
docker compose start app
```

### Restore a Single Tenant Database

```bash
# 1. Stop the app
docker compose stop app

# 2. Copy and decrypt the tenant backup (pg_dumpall contains all DBs)
docker cp simi-backup-tenant:/backups/all_databases_2026-07-14_000001.sql.gz.gpg ./backup.sql.gz.gpg
gpg --decrypt --batch --passphrase "YOUR_BACKUP_ENCRYPT_PASSPHRASE" \
  backup.sql.gz.gpg > backup.sql.gz
gunzip backup.sql.gz

# 3. The pg_dumpall output includes role creation and all databases.
#    To restore a specific tenant database, extract the relevant section
#    or restore the entire dump:
docker compose exec -T postgres-tenant \
  psql -U simi_tenant_admin -d postgres < backup.sql

# 4. Restart the app
docker compose start app
```

> **Note:** When restoring from `pg_dumpall`, existing databases may conflict.
> Drop the target tenant database first if it exists:
> ```bash
> docker compose exec postgres-tenant \
>   psql -U simi_tenant_admin -d postgres \
>   -c "DROP DATABASE IF EXISTS tenant_acme;"
> ```

### Restore as a New Tenant (Point-in-Time Recovery)

To restore a backup into a new tenant for inspection without affecting the live tenant:

```bash
# 1. Create a new database from the backup
docker compose exec postgres-tenant \
  psql -U simi_tenant_admin -d postgres \
  -c "CREATE DATABASE tenant_acme_restored;"

# 2. Restore the dump into the new database
docker compose exec postgres-tenant \
  pg_restore -U simi_tenant_admin -d tenant_acme_restored \
  --no-owner --no-privileges backup.sql
```

---

## Manual Backup

To trigger a backup outside the scheduled time:

```bash
# Force a backup by restarting the backup container
docker compose restart backup-global
docker compose restart backup-tenant
```

Or run `pg_dump` directly:

```bash
# Manual global backup (encrypted)
docker compose exec postgres-global \
  pg_dump -U simi_global_admin simi_global -Z6 \
  | gpg --symmetric --batch --passphrase "YOUR_PASSPHRASE" \
  > manual_global_backup.sql.gz.gpg

# Manual tenant backup (all databases, encrypted)
docker compose exec postgres-tenant \
  pg_dumpall -U simi_tenant_admin -Z6 \
  | gpg --symmetric --batch --passphrase "YOUR_PASSPHRASE" \
  > manual_tenant_backup.sql.gz.gpg
```

---

## Retention and Cleanup

The backup sidecars handle retention automatically:

- **`BACKUP_KEEP_DAYS: 30`** — files older than 30 days are deleted.
- **`BACKUP_KEEP_COUNT: 90`** — if more than 90 files exist, the oldest are deleted.

Both conditions are checked; the stricter one wins. This means you always have at least
the last 30 days of backups, or 90 files, whichever is more.
