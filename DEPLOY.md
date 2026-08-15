# Deploying to AWS (single EC2 instance)

Postgres, the API and Caddy all run as containers on one EC2 box. Caddy
terminates TLS; the database and the API are reachable only from the private
compose network.

Because the database lives on this instance, **backups are your job** — step 7
is not optional.

## 1. EC2

Region: **ap-south-1 (Mumbai)**.

- AMI: Ubuntu 24.04 LTS
- Instance: `t4g.small` (ARM, 2 GB RAM — enough for Postgres + Node + Caddy)
- Storage: 30 GB gp3. The default 8 GB fills up fast once Docker images,
  database and backups share a disk.
- Create a key pair and download the `.pem`
- Security group:

  | Port | Source | Why |
  |------|--------|-----|
  | 22 | your IP only | SSH |
  | 80 | 0.0.0.0/0 | HTTP → HTTPS redirect, and ACME challenges |
  | 443 | 0.0.0.0/0 | HTTPS |

  **Postgres (5432) is not in this list and must never be.** The database is
  not published to the host at all; only the API container reaches it.

Then allocate an **Elastic IP** and associate it. A default public IP changes
on every stop/start and silently breaks DNS.

## 2. Install Docker

```bash
ssh -i your-key.pem ubuntu@YOUR_ELASTIC_IP

sudo apt update && sudo apt install -y docker.io docker-compose-v2 git
sudo usermod -aG docker ubuntu
exit   # log back in for the group change to apply
```

Cap container logs before they fill the disk — the most common way a small
instance falls over:

```bash
sudo tee /etc/docker/daemon.json <<'JSON'
{ "log-driver": "json-file", "log-opts": { "max-size": "10m", "max-file": "3" } }
JSON
sudo systemctl restart docker
```

## 3. DNS

Point `api.yourdomain.com` at the Elastic IP with an **A record**. Do this
before starting Caddy — certificate issuance fails if the name does not yet
resolve here.

## 4. Clone and configure

```bash
git clone git@github.com:Appu2279/amc-catalyst-backend.git
cd amc-catalyst-backend
```

Create `.env` next to the compose file (never committed):

```ini
DB_NAME=amc_catalyst
DB_USER=amc
DB_PASSWORD=            # long and random: openssl rand -base64 24
JWT_SECRET=             # fresh, not the dev value: openssl rand -hex 32
CORS_ORIGIN=https://yourdomain.com,https://www.yourdomain.com
API_DOMAIN=api.yourdomain.com
```

## 5. Start

```bash
docker compose -f docker-compose.prod.yml up -d --build
docker compose -f docker-compose.prod.yml ps      # all three healthy
curl https://api.yourdomain.com/health            # {"status":"ok",...}
```

## 6. Load the data

The schema is not created automatically — `sync({ alter: true })` is disabled in
production by design. Your dump carries both schema and data.

From your laptop:

```bash
scp -i your-key.pem \
  ~/Others/backups/amc_catalyst_20260816.sql \
  ubuntu@YOUR_ELASTIC_IP:/home/ubuntu/
```

On the server:

```bash
cd amc-catalyst-backend
docker compose -f docker-compose.prod.yml exec -T db \
  psql -U amc -d amc_catalyst < /home/ubuntu/amc_catalyst_20260816.sql
```

The compose file pins **postgres:18**, matching the local server the dump came
from, so the `transaction_timeout` setting in it restores cleanly.

Verify before trusting it:

```bash
docker compose -f docker-compose.prod.yml exec -T db \
  psql -U amc -d amc_catalyst -c \
  "select (select count(*) from questions) questions,
          (select count(*) from users) users,
          (select count(*) from courses) courses;"
```

Expect **146 questions, 9 users, 4 courses**.

## 7. Backups — do this now, not later

```bash
mkdir -p /home/ubuntu/backups
crontab -e
```

Add:

```
0 3 * * * /home/ubuntu/amc-catalyst-backend/scripts/backup-db.sh >> /home/ubuntu/backup.log 2>&1
```

Run it once by hand to confirm it works, then **test a restore into a scratch
database**. An untested backup is a guess.

Nightly dumps on the same disk do not protect you from a terminated instance or
a lost volume. Create an S3 bucket, attach an IAM role to the instance, and
uncomment the `aws s3 cp` line at the bottom of the script.

Also enable **EBS snapshots** on the volume (Data Lifecycle Manager, daily,
7-day retention) — a second, independent line of defence.

## 8. Admin account

```bash
docker compose -f docker-compose.prod.yml exec \
  -e ADMIN_EMAIL=you@yourdomain.com \
  -e ADMIN_PASSWORD='<from your password manager>' \
  api npm run admin:reset
```

## 9. Point the frontend at it

In Vercel: `VITE_API_URL=https://api.yourdomain.com/api`, then **redeploy** —
the value is compiled into the bundle at build time, so changing it without a
rebuild does nothing.

---

## Operating it

**Deploy a change**

```bash
git pull && docker compose -f docker-compose.prod.yml up -d --build
```

Postgres is untouched by this; the named volume persists across rebuilds.

**Logs**

```bash
docker compose -f docker-compose.prod.yml logs -f api
docker compose -f docker-compose.prod.yml logs -f db
```

**Never run `docker compose down -v`.** The `-v` deletes the volume, and with it
the database. Plain `down` is safe.

**Restore from a backup**

```bash
gunzip -c /home/ubuntu/backups/amc_catalyst_YYYYMMDD-HHMMSS.sql.gz | \
  docker compose -f docker-compose.prod.yml exec -T db psql -U amc -d amc_catalyst
```

**Disk usage** — check occasionally, since database, images and backups share
one volume:

```bash
df -h /
docker system df
docker system prune -f        # removes unused images and build cache
```

**Schema changes.** Auto-sync is off in production, so a model change does not
alter live tables. Apply schema changes deliberately with SQL, then deploy.
