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

**IAM role:** attach a role granting `s3:PutObject`/`s3:GetObject`/`s3:DeleteObject`
on the notes/screenshots bucket (Actions → Security → Modify IAM role). This is
how the API authenticates to S3 in production — no access keys in `.env`.

**Metadata hop limit:** Actions → Instance settings → Modify instance metadata
options → set **Metadata response hop limit** to `2`. The API runs inside a
Docker container, and a request from inside a container to the instance's
metadata service (where the IAM role's temporary credentials come from) is one
hop further than the default limit of 1 allows. Leaving this at 1 means the
container gets no AWS credentials and every S3 call fails, while everything
else works fine — a confusing failure mode to debug blind, so set it now.

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

# Study notes and payment screenshots are stored here as private S3 objects.
# Leave the key/secret unset on EC2 — the instance's IAM role supplies
# credentials automatically. Without S3_BUCKET set the API still runs, but
# notes cannot be uploaded or opened and the server logs a warning at boot.
AWS_REGION=ap-south-1
S3_BUCKET=
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

## 6b. Updating an existing deployment

**Migrate before you cut over, not after.** Sequelize selects every attribute a
model declares, so the instant the new code is *serving traffic* against a
database still missing a column it added, every query that touches that table
fails — not just the new feature, the whole table. `docker compose run` runs
the new image's migration scripts as a one-off container, on the same database,
**without** replacing the running (old-code) container — so the old code keeps
serving normally for the entire window while the schema catches up to it.

```bash
cd amc-catalyst-backend
git pull
docker compose -f docker-compose.prod.yml build api
```

Then, still with the *old* container serving traffic:

```bash
docker compose -f docker-compose.prod.yml run --rm api npm run db:create-new
docker compose -f docker-compose.prod.yml run --rm api npm run db:set-sections
docker compose -f docker-compose.prod.yml run --rm api npm run db:migrate-entitlements
```

**This order matters, not just their presence.** `db:migrate-entitlements`
snapshots every existing subscription's granted sections from its course's
*current* `sections` column — run it before `db:set-sections` has populated
real values there and every existing paying subscriber gets snapshotted with
`granted_sections: []`, which the entitlement check reads as "grants nothing."
That is every current customer locked out of what they already paid for, and
`db:create-new` is what adds the `sections`/`granted_sections` columns in the
first place, so it has to come first of the three.

Read each command's output before moving to the next — `db:set-sections`
prints `CANNOT BE SOLD` next to any plan it couldn't resolve sections for, and
`db:migrate-entitlements` prints a `WARNING` line per subscription it could not
reconstruct (its course was deleted before this migration ran). Stop and look
into it rather than continuing on to the next command if either does.

Once all three report clean, cut over:

```bash
docker compose -f docker-compose.prod.yml up -d api
```

`db:create-new` only ever adds what is missing and is safe to re-run;
`db:set-sections` and `db:migrate-entitlements` are also safe to re-run — skip
none of them, a partial run leaves the database in a state none of the code
(old or new) was written against.

Deploy the API **before** the frontend. The new frontend calls endpoints that
only exist in this release, so shipping it first gives students a broken Notes
and Recall until the API catches up.

### S3 (Cloudinary → S3 migration)

The API now reads `AWS_REGION`/`S3_BUCKET` from `.env` and gets credentials
from the EC2 instance's IAM role — not from a key in the environment. Before
this deploy:

- The instance has an IAM role granting `s3:PutObject`/`s3:GetObject`/
  `s3:DeleteObject` on the bucket (Instance → Actions → Security → Modify IAM
  role).
- **Metadata hop limit is 2, not the default 1** (Instance → Actions →
  Instance settings → Modify instance metadata options). The API runs inside a
  container, and a request from inside a container to the instance's metadata
  service — where the role's credentials come from — is one hop further than
  the default allows. Skip this and the container gets no AWS credentials at
  all: every note upload/view and every payment screenshot fails with a 503,
  while everything else works, which is a confusing thing to debug blind.
- Any note uploaded before this migration has a Cloudinary-era
  `storage_public_id` and no matching S3 object — opening it now 403s. Same
  fix as we used locally: delete the row in Admin → Notes and re-upload the
  original PDF, which registers it against S3 under a fresh key. Check
  production's Notes list for any of these before announcing the release.

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

**Connecting DBeaver (or any GUI client)**

Postgres listens on the instance's loopback interface only, so the route in is
an SSH tunnel. Nothing needs opening in the security group.

In DBeaver, on the **SSH** tab of the connection:

| Field | Value |
|---|---|
| Host | your Elastic IP |
| Port | 22 |
| User | `ubuntu` |
| Authentication | Public key → your `.pem` file |

Then on the **Main** tab — these are resolved *through* the tunnel, so `localhost`
means the EC2 instance, not your Mac:

| Field | Value |
|---|---|
| Host | `localhost` |
| Port | `5432` |
| Database | `amc_catalyst` |
| User / Password | `DB_USER` / `DB_PASSWORD` from the server's `.env` |

The same thing from a terminal, if you prefer:

```bash
ssh -i your-key.pem -L 5433:localhost:5432 ubuntu@YOUR_ELASTIC_IP
# then, in another shell — 5433 avoids clashing with your local Postgres
psql -h localhost -p 5433 -U amc -d amc_catalyst
```

Anyone who can open this tunnel already has SSH access to the box, so keep port
22 restricted to your own IP and guard the `.pem`.

**Disk usage** — check occasionally, since database, images and backups share
one volume:

```bash
df -h /
docker system df
docker system prune -f        # removes unused images and build cache
```

**Schema changes.** Auto-sync is off in production, so a model change does not
alter live tables. Apply schema changes deliberately with SQL, then deploy.

---

## Alternative: start with an empty database

Instead of restoring the dump (step 6), you can create the schema from the
models and load only the seeded data:

```bash
docker compose -f docker-compose.prod.yml exec api npm run db:sync
docker compose -f docker-compose.prod.yml exec \
  -e ADMIN_EMAIL=you@amccatalyst.com \
  -e ADMIN_PASSWORD='<from your password manager>' \
  api npm run db:seed:run
```

`db:sync` refuses to run against a database that already has tables, so it
cannot quietly rewrite a live schema; pass `--alter` only after taking a dump.
`db:seed:run` calls the seeders directly rather than through sequelize-cli,
which is a devDependency and not present in the production image.

**What you get:** the 4 pricing plans and an admin account.

**What you do not get:** questions, options, subjects, topics, mock tests, and
the users who have already registered. That content is only in the dump. Take
this route only if you intend to import questions again from scratch.
