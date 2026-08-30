# USRMusic Backend

REST API for USRMusic, a DJ/entertainment business management CRM. Built with Node.js (ESM), Express, and Prisma v7 over MySQL/MariaDB. Manages the full event lifecycle: lead capture → enquiries → confirmed events → digital contracts → invoices → payments → completed events.

## Tech Stack

- **Runtime:** Node.js (ESM, `"type": "module"`)
- **Framework:** Express 4.x
- **ORM:** Prisma v7 + `@prisma/adapter-mariadb`
- **Database:** MySQL / MariaDB
- **Auth:** Custom JWT (HS256) via `jsonwebtoken` + `bcrypt`
- **Email:** Resend
- **File storage:** AWS S3 (`@aws-sdk/client-s3`, presigned URLs), local disk in dev
- **File upload:** Multer
- **PDF generation:** PDFKit + Puppeteer (headless Chromium)
- **Validation:** Joi
- **Security:** Helmet, CORS allowlist
- **Logging:** Morgan
- **Scheduling:** node-cron (background jobs)

## Quick Start (Local Development)

1. Create a `.env.local` file in the project root with the variables listed below (see [Environment Variables](#environment-variables)).

2. Install dependencies:
   ```bash
   npm install
   ```

3. Generate the Prisma client:
   ```bash
   npx prisma generate
   ```

4. Push the schema to your database (or run migrations):
   ```bash
   npx prisma db push
   ```

5. Run the dev server:
   ```bash
   npm run dev
   # Server runs on http://localhost:4000 (or $PORT)
   ```

## Project Structure

```
Backend/
├── src/
│   ├── server.js                  # Entry point, graceful shutdown (SIGINT/SIGTERM)
│   ├── app.js                     # Express setup, middleware stack, route mounts
│   ├── config/                    # Env loading, S3 client
│   ├── middleware/                # Auth, permissions, error handling, validation
│   ├── utils/                     # AppError, catchAsync, activity logger, email templates
│   ├── services/                  # Business logic (per feature) + generic CRUD service
│   ├── routes/                    # One file per feature, mounted in app.js
│   ├── controllers/                # One file per feature
│   ├── validation/                # Joi schemas per feature
│   └── jobs/                      # Cron jobs (auto-complete events, recalc profits)
├── prisma/
│   └── schema.prisma              # Canonical DB schema
├── scripts/
│   └── pruneExpired.js            # Deletes expired file_uploads rows + S3 objects
└── API_DOCUMENTATION.md           # Postman-style endpoint reference
```

## Environment Variables

| Variable | Default | Purpose |
|---|---|---|
| `DATABASE_URL` | — | MySQL connection string |
| `PORT` | `4000` | HTTP listen port |
| `JWT_SECRET` | — | HS256 signing key |
| `JWT_ACCESS_EXPIRATION_MINUTES` | ~10080 (7d) | Access token TTL in minutes |
| `REFRESH_TOKEN_DAYS` | `30` | Refresh token TTL in days |
| `REFRESH_COOKIE_NAME` | — | httpOnly refresh cookie name |
| `REFRESH_COOKIE_PATH` | `/` | Cookie path |
| `COOKIE_SECURE` | — | `true` in production (HTTPS only) |
| `COOKIE_SAME_SITE` | — | `lax` or `strict` |
| `RESEND_API_KEY` | — | Resend email service API key |
| `PERSISTENT_UPLOADS_DIR` | `./uploads` | Local file storage path |
| `COMPLETE_EVENTS_CRON` | `0 0 * * *` | Cron for auto-completing past events |
| `RECALCULATE_PROFITS_CRON` | `0 2 * * *` | Cron for profit recalculation |
| `CONFIRMED_STATUS_ID` | `2` | Event status ID for "Confirmed" |
| `COMPLETED_STATUS_ID` | `3` | Event status ID for "Completed" |
| `PERM_CACHE_TTL_SEC` | `60` | Permission cache TTL in seconds |
| `DEBUG_PERMS` | — | Set `true` to log permission checks |
| `DEBUG_AUTH` | — | Set `true` to log auth middleware |
| `NODE_ENV` | — | `development` or `production` |

Also requires AWS credentials/region config for S3 (via standard AWS SDK env vars or an attached role) when file storage is used in production.

## Scripts

```bash
npm run dev                   # nodemon dev server, loads .env.local via env-cmd
npm run local                 # one-off run, loads .env.local via env-cmd
npm start                     # production start (node --max-old-space-size=512)
npx prisma generate           # regenerate Prisma client after schema changes
npx prisma db push            # sync schema to DB (dev)
npx prisma migrate dev        # create + apply a migration (dev)
npx prisma migrate deploy     # apply migrations (production)
npx prisma studio             # visual DB browser at localhost:5555
```

## Deployment (Railway)

1. Create a Railway project and add a **MySQL** service (`DATABASE_URL` is auto-provided).
2. Connect this GitHub repo to Railway.
3. Set the remaining environment variables above in the Railway dashboard.
4. Ensure Chromium is available in the deploy environment (required by Puppeteer for PDF generation).
5. Build command: `npm install && npx prisma generate`
6. Start command: `npm start`
7. Run `npx prisma migrate deploy` for schema migrations as part of deploy.

## Auth & Permissions

- JWT (HS256) access tokens + httpOnly refresh cookie, refresh tokens hashed and stored in `personal_access_tokens`.
- Spatie-compatible RBAC: `role_has_permissions`, `model_has_permissions`, `model_has_roles`, checked via `checkPermission` middleware with an in-memory cache (`PERM_CACHE_TTL_SEC`).
- Contract signing (`/api/contract/:token`, `/api/contract/:token/sign`) is public and token-based — no login required.

## Background Jobs

- **completeEventsJob** — daily: auto-marks past confirmed events as completed.
- **recalculateProfitsJob** — daily: recomputes profit fields across events.

## Notes

- This backend, together with the Next.js frontend, is a feature-complete rewrite of a legacy Laravel monolith. Both share the same MySQL database.
- See `API_DOCUMENTATION.md` for the full endpoint reference.
