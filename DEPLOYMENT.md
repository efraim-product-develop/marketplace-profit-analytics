# Deployment Guide

This app is a Next.js + Prisma + Supabase application. The simplest hosting path
is Vercel for the website and Supabase for the database.

## Recommended First Hosting Setup

Use:

- Vercel for the Next.js app.
- Supabase for Postgres.
- GitHub as the connection between your local code and Vercel.

The app has a single-owner login. Keep the login environment variables private
and use a strong password and signing secret.

## Environment Variables

Set these in Vercel Project Settings -> Environment Variables for Production and
Preview:

```env
DATABASE_URL=""
DIRECT_URL=""
WALMART_MARKETPLACE_CLIENT_ID=""
WALMART_MARKETPLACE_CLIENT_SECRET=""
WALMART_MARKET="us"
WALMART_SERVICE_NAME="Walmart Marketplace"
WALMART_API_BASE_URL="https://marketplace.walmartapis.com"
WALMART_CONSUMER_CHANNEL_TYPE=""
WALMART_SELLER_ID=""
APP_LOGIN_EMAIL=""
APP_LOGIN_PASSWORD=""
AUTH_SECRET=""
```

For Vercel/serverless runtime, prefer the Supabase transaction pooler for
`DATABASE_URL`:

```text
postgresql://postgres.PROJECT_REF:PASSWORD@POOLER_HOST:6543/postgres?pgbouncer=true&connection_limit=1&pool_timeout=20&sslmode=require
```

Transaction mode is required for Vercel's serverless functions. The
`connection_limit=1` guard prevents each warm function instance from opening a
five-connection Prisma pool and exhausting the Supabase free-plan connection
limit.

For Prisma migrations and CLI work, use the Supabase session pooler for
`DIRECT_URL`:

```text
postgresql://postgres.PROJECT_REF:PASSWORD@POOLER_HOST:5432/postgres?sslmode=require
```

Copy the exact pooler host from Supabase. Do not infer it from the region.

Generate `AUTH_SECRET` locally with:

```powershell
powershell -NoProfile -Command "[Convert]::ToBase64String([Security.Cryptography.RandomNumberGenerator]::GetBytes(32))"
```

Use your own email and a strong password for `APP_LOGIN_EMAIL` and
`APP_LOGIN_PASSWORD`.

## Vercel Project Settings

Use the default Next.js preset.

Recommended commands:

```text
Install Command: pnpm install --frozen-lockfile
Build Command: pnpm run build
Output Directory: .next
```

The `postinstall` script runs `prisma generate`, so Vercel gets a fresh Prisma
Client during install.

Do not run `prisma migrate deploy` automatically during every Vercel build for
now. Apply migrations intentionally from local PowerShell before deployment.

## First Deployment Steps

From local PowerShell:

```powershell
cd "C:\Users\Ebacher\Documents\Codex\2026-06-22\create-a-next-js-14-typescript"
pnpm install
pnpm run prisma:deploy
pnpm run prisma:generate
pnpm run typecheck
pnpm run lint
pnpm run test
pnpm run build
git status
```

Then:

1. Commit the current app version.
2. Push the repository to GitHub.
3. Import the GitHub repository into Vercel.
4. Add the environment variables above in Vercel.
5. Deploy.
6. Open the deployed app and confirm it redirects to `/login`.
7. Sign in and check:
   - `/`
   - `/imports`
   - `/imports/seller-shipping`
   - `/pnl/parent`
   - `/pnl/sku`
   - `/connections`

## File Upload Notes

Manual imports currently run inside the web request that receives the uploaded
file. This is fine for normal reports, but very large Walmart files can hit
hosted function time limits. If that happens, move heavy imports into a
background job or use a long-running host such as Railway/Fly/Render.

## Local Development Still Works

Hosting does not replace the local app. You can keep using:

```powershell
pnpm run dev
```

The hosted site and the local site can point to the same Supabase database or to
separate databases, depending on what you put in each environment's
`DATABASE_URL`.
