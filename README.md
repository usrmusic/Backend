# Backend Boilerplate (Express + Prisma v7 + Auth0)

RBAC backend using Node.js (ESM), Express, Auth0 (access token validation), Prisma v7 (MySQL), Resend, and file uploads.

## Quick Start (Local Development)

1. **Copy environment file:**
```bash
# Windows (cmd)
copy .env.local .env

# Or PowerShell/macOS/Linux
cp .env.local .env
```

2. **Install dependencies:**
```bash
npm install
```

3. **Generate Prisma client:**
```bash
npx prisma generate
```

4. **Run dev server:**
```bash
npm run dev
# Server runs on http://localhost:4000
```

## Project Structure

```
backend/
├── prisma/
│   └── schema.prisma        # Prisma models (generated from CSV schema)
├── src/
│   ├── app.js               # Express app setup
│   ├── server.js            # Server entry + graceful shutdown
│   ├── config/              # Environment config
│   ├── controllers/         # Route controllers
│   ├── middleware/          # Auth0 JWT verification
│   ├── routes/              # API routes
│   ├── utils/               # AppError, catchAsync, errorHandler
│   └── prismaClient.js      # Prisma client instance
├── uploads/                 # Local file uploads (use S3 in production)
├── prisma.config.js         # Prisma v7 config (loads DATABASE_URL from env)
├── .env.local               # Local environment variables
└── package.json
```

## Environment Variables

**Local (.env or .env.local):**
- `DATABASE_URL` - MySQL connection (e.g., `mysql://root:@127.0.0.1:3306/usrmusic_dev`)
- `PORT` - Server port (default: 4000)
- `AUTH0_DOMAIN` - Your Auth0 domain
- `AUTH0_AUDIENCE` - Your Auth0 API audience
- `RESEND_API_KEY` - Resend API key for emails

Prisma CLI env loading note:
- When `NODE_ENV=local` the project will load `.env.local` then `.env`.
- When `NODE_ENV=production` the project prefers injected envs (Railway) and will optionally load `.env.production`.
- Otherwise `.env` is loaded. Set `NODE_ENV` appropriately when running Prisma commands locally.

**Railway (set in project Environment variables):**
- Railway auto-provides `DATABASE_URL` when you add a MySQL service
- Set all other vars manually in Railway dashboard

## Scripts

```bash
npm run local       # Run with .env.local (via env-cmd)
npm run dev         # Dev mode with nodemon + .env.local
npm run start       # Production mode (reads Railway env vars directly)
npm run production  # Same as start

npx prisma generate                  # Generate Prisma client
npx prisma migrate dev --name init   # Create and apply migration (local)
npx prisma migrate deploy            # Apply migrations (production/Railway)
npx prisma db pull                   # Pull schema from existing DB
```

## Deployment (Railway)

1. **Create Railway project** and add a **MySQL** service.
2. **Connect GitHub repo** to Railway.
3. **Set environment variables** in Railway dashboard:
   - `AUTH0_DOMAIN`
   - `AUTH0_AUDIENCE`
   - `RESEND_API_KEY`
   - `NODE_ENV=production`
   - (Railway auto-provides `DATABASE_URL`)

4. **Add build command** (optional, Railway auto-detects):
   ```
   npm install && npx prisma generate
   ```

5. **Add start command**:
   ```
   npm run start
   ```

6. **Run migrations** (one-time or in Railway deploy settings):
   ```
   npx prisma migrate deploy
   ```

## Tech Stack

- **Node.js** (ESM modules)
- **Express** - Web framework
- **Prisma v7** - ORM with MySQL
- **Auth0** - JWT access token validation (RS256 + JWKS)
- **Resend** - Email service
- **Multer** - File uploads (disk storage; replace with S3 for production)
- **Helmet** - Security headers
- **Morgan** - HTTP logging

## Auth & Security

- **Auth0 middleware** validates Bearer tokens using JWKS (see `src/middleware/auth0.js`)
- **Centralized error handler** hides internal errors in production
- **Graceful shutdown** disconnects Prisma on SIGTERM/SIGINT
- All routes under `/api` are available; protect routes with `verifyAccessToken` middleware

## Notes

- The Prisma schema was generated from your CSV schema. If your DB already exists, point `DATABASE_URL` at it and run `npx prisma db pull` to sync models.
- For production file uploads, replace local disk storage with S3/Railway volumes.
- Add role-based middleware and sync super-user creation with Auth0 Management API as needed.
