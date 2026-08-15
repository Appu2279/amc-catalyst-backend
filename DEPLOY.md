# Deploying to AWS (EC2 + RDS)

The API runs in a container on EC2 behind Caddy, which terminates TLS. Postgres
is RDS, so the database survives anything that happens to the instance.

## 1. RDS

Create a PostgreSQL instance in **ap-south-1 (Mumbai)** — closest to where your
registrations are actually coming from, and the cheapest of the nearby regions.

- Instance: `db.t4g.micro` is enough for now
- Storage: 20 GB gp3
- **Public access: No** — only the EC2 instance should reach it
- Automated backups: 7 days
- Note the endpoint, username and password

## 2. EC2

- AMI: Ubuntu 24.04 LTS, `t4g.small` (ARM — cheaper, and the Docker images build fine)
- **Allocate an Elastic IP and attach it.** A default public IP changes on every
  stop/start and silently breaks your DNS.
- Security group:

  | Port | Source | Why |
  |------|--------|-----|
  | 22 | your IP only | SSH |
  | 80 | 0.0.0.0/0 | HTTP → redirects to HTTPS, and ACME challenges |
  | 443 | 0.0.0.0/0 | HTTPS |

  Postgres (5432) is **not** in this list. RDS is reached over the private
  network via its own security group, which should allow 5432 only from the
  EC2 instance's security group.

Install Docker:

```bash
sudo apt update && sudo apt install -y docker.io docker-compose-v2 git
sudo usermod -aG docker ubuntu   # log out and back in for this to apply
```

## 3. DNS

Point `api.yourdomain.com` at the Elastic IP with an **A record**. Do this
before starting Caddy — certificate issuance fails if the name does not yet
resolve to this server.

## 4. Migrate the database

From your laptop, where the data currently lives:

```bash
pg_dump amc_catalyst > amc_backup.sql
psql "postgresql://USER:PASSWORD@RDS_ENDPOINT:5432/amc_catalyst" < amc_backup.sql
```

Keep `amc_backup.sql`. Then confirm the counts match what you had locally:
146 questions, 584 options, 4 courses, and your registered users.

## 5. Deploy

```bash
git clone git@github.com:Appu2279/amc-catalyst-backend.git
cd amc-catalyst-backend
```

Create `.env` on the server (never committed):

```ini
DATABASE_URL=postgresql://USER:PASSWORD@RDS_ENDPOINT:5432/amc_catalyst
JWT_SECRET=            # openssl rand -hex 32 — a fresh one, not the dev value
CORS_ORIGIN=https://yourdomain.com,https://www.yourdomain.com
API_DOMAIN=api.yourdomain.com
```

Then:

```bash
docker compose -f docker-compose.prod.yml up -d --build
curl https://api.yourdomain.com/health     # {"status":"ok",...}
```

## 6. Create the admin account

```bash
docker compose -f docker-compose.prod.yml exec api \
  env ADMIN_EMAIL=you@yourdomain.com ADMIN_PASSWORD='<from your password manager>' \
  npm run admin:reset
```

## 7. Point the frontend at it

In Vercel: `VITE_API_URL=https://api.yourdomain.com/api`, then **redeploy** —
the value is compiled into the bundle at build time, so changing it without a
rebuild does nothing.

---

## Operating it

**Deploying a change**

```bash
git pull && docker compose -f docker-compose.prod.yml up -d --build
```

**Backups.** RDS handles automated backups, but they expire on the retention
window you chose. Before any risky change, take your own:

```bash
pg_dump "$DATABASE_URL" > backup-$(date +%F).sql
```

**Logs**

```bash
docker compose -f docker-compose.prod.yml logs -f api
```

**Disk.** The most common way a small instance falls over is a full disk from
container logs. Cap them in `/etc/docker/daemon.json`:

```json
{ "log-driver": "json-file", "log-opts": { "max-size": "10m", "max-file": "3" } }
```

then `sudo systemctl restart docker`.

**Schema changes.** `sync({ alter: true })` is disabled in production by design,
so a model change does not alter live tables. Apply schema changes deliberately
with SQL or a migration, then deploy.
