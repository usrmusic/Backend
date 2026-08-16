-- Item 1: DJ colour-coding across the shared calendar
--
-- Adds a per-user calendar identity colour, stored as a single `#rrggbb`.
-- NULL means "not assigned yet" — both calendars fall back to neutral grey,
-- so this ships without a backfill and without a broken intermediate state.
--
-- Additive and nullable: safe for the legacy Laravel app, which shares this
-- schema and never references the column.
--
-- Applying it:
--   This project has only ever used `prisma db push` — `prisma/migrations/` is
--   empty, so Prisma's migration engine has no baseline. Do NOT run
--   `prisma migrate dev` here; without a baseline it can propose dropping
--   tables it doesn't recognise. Either run this file directly against the
--   database, or use `npx prisma db push`, which is safe for an additive
--   nullable column and matches how the schema has always been changed.
--
--   Afterwards: npx prisma generate

ALTER TABLE users ADD COLUMN color VARCHAR(7) NULL;
