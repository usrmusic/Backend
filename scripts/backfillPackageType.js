// One-off backfill: set event_package.package_type_id (1=basics, 2=extras) for
// rows where it is currently NULL.
//
// Inference (parity with how createEnquiry/Laravel split items):
//   - An event_package row whose equipment_id belongs to the event's DJ package
//     (package_users matched by user_id = event.dj_id AND package_name =
//     event.dj_package_name) -> BASIC (1).
//   - Otherwise -> EXTRA (2).
//   - If the DJ package can't be resolved, fall back: rows with a non-zero
//     sell_price -> 2 (extras are usually priced), else -> 1. Counted/logged.
//
// Idempotent: only touches rows where package_type_id IS NULL.
//
// Run (stop the dev server first so a pool connection is free):
//   cd Backend && node -r dotenv/config scripts/backfillPackageType.js

import "dotenv/config";
import prisma from "../src/utils/prismaClient.js";

async function ensurePackageTypes() {
  const existing = await prisma.packageType.findMany({
    where: { id: { in: [BigInt(1), BigInt(2)] } },
    select: { id: true },
  });
  const have = new Set(existing.map((r) => Number(r.id)));
  if (!have.has(1))
    await prisma.packageType
      .create({ data: { id: BigInt(1), type: "BASIC", created_at: new Date() } })
      .catch(() => {});
  if (!have.has(2))
    await prisma.packageType
      .create({ data: { id: BigInt(2), type: "EXTRAS", created_at: new Date() } })
      .catch(() => {});
}

// Resolve the set of basics equipment_ids for an event's DJ package.
// Cache by `${dj_id}::${dj_package_name}` to avoid repeat queries.
const basicsCache = new Map();
async function basicsSetForEvent(event) {
  const djId = event.dj_id != null ? Number(event.dj_id) : null;
  const pkgName = event.dj_package_name || null;
  if (!djId || !pkgName) return null; // cannot resolve
  const cacheKey = `${djId}::${pkgName}`;
  if (basicsCache.has(cacheKey)) return basicsCache.get(cacheKey);

  // resolve the DJ package ids, then their equipment directly (querying
  // package_user_equipment on its own rather than via a nested include).
  const pkgs = await prisma.package_users.findMany({
    where: { user_id: djId, package_name: pkgName },
    select: { id: true },
  });
  const set = new Set();
  if (pkgs.length) {
    const pue = await prisma.package_user_equipment.findMany({
      where: { package_user_id: { in: pkgs.map((p) => p.id) } },
      select: { equipment_id: true },
    });
    for (const e of pue) {
      if (e.equipment_id != null) set.add(Number(e.equipment_id));
    }
  }
  const result = set.size ? set : null;
  basicsCache.set(cacheKey, result);
  return result;
}

async function main() {
  await ensurePackageTypes();

  const nullRows = await prisma.eventPackage.findMany({
    where: { package_type_id: null },
    select: { id: true, event_id: true, equipment_id: true, sell_price: true },
  });

  console.log(`[backfill] ${nullRows.length} event_package rows with NULL package_type_id`);
  if (!nullRows.length) {
    console.log("[backfill] nothing to do.");
    return;
  }

  // group rows by event so we resolve each DJ package once
  const byEvent = new Map();
  for (const r of nullRows) {
    const eid = Number(r.event_id);
    if (!byEvent.has(eid)) byEvent.set(eid, []);
    byEvent.get(eid).push(r);
  }

  let setBasics = 0;
  let setExtras = 0;
  let defaulted = 0;

  for (const [eventId, rows] of byEvent) {
    const event = await prisma.event
      .findUnique({
        where: { id: eventId },
        select: { id: true, dj_id: true, dj_package_name: true },
      })
      .catch(() => null);

    const basics = event ? await basicsSetForEvent(event) : null;

    const basicIds = [];
    const extraIds = [];
    for (const r of rows) {
      const eqId = r.equipment_id != null ? Number(r.equipment_id) : null;
      let type;
      if (basics) {
        type = eqId != null && basics.has(eqId) ? 1 : 2;
      } else {
        // fallback inference
        type = Number(r.sell_price) > 0 ? 2 : 1;
        defaulted += 1;
      }
      if (type === 1) basicIds.push(r.id);
      else extraIds.push(r.id);
    }

    if (basicIds.length) {
      await prisma.eventPackage.updateMany({
        where: { id: { in: basicIds } },
        data: { package_type_id: BigInt(1) },
      });
      setBasics += basicIds.length;
    }
    if (extraIds.length) {
      await prisma.eventPackage.updateMany({
        where: { id: { in: extraIds } },
        data: { package_type_id: BigInt(2) },
      });
      setExtras += extraIds.length;
    }
  }

  console.log(
    `[backfill] done. scanned=${nullRows.length} set_basics=${setBasics} set_extras=${setExtras} defaulted=${defaulted} (events=${byEvent.size})`,
  );
  if (defaulted) {
    console.log(
      `[backfill] note: ${defaulted} rows had no resolvable DJ package and were typed by sell_price heuristic (priced -> extra).`,
    );
  }
}

main()
  .catch((e) => {
    console.error("[backfill] ERROR", e?.code, e?.message);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect().catch(() => {});
  });
