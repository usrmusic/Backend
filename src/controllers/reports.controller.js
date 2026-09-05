import prisma from "../utils/prismaClient.js";
import catchAsync from "../utils/catchAsync.js";
import { serializeForJson } from "../utils/serialize.js";
import { parseFilterSort } from "../utils/queryHelpers.js";
import { logActivity } from "../utils/activityLogger.js";
// Supplier/DJ payment-tracking report — parity with Laravel's
// SuppliersReportService::getSuppliersReport() + SuppliersReportController's
// calculateSupplierReport()/updateData(). This is an accounts-payable view
// (money WE owe suppliers/DJs and have/haven't paid them), driven entirely by
// the payment_send flag — NOT client payments. Two distinct row types are
// merged into one table, exactly like Laravel:
//   - one row per event_package line ("equipment" rows), cost frozen to
//     event_package.cost_price once the event is Completed, live
//     equipment.cost_price while still Confirmed
//   - one row per event's assigned DJ ("DJ" rows, equipment_name = "DJ"),
//     same confirmed/completed frozen-price split via package_users vs
//     events.dj_cost_price_for_event
// Only Confirmed(2)/Completed(3) events are in scope; equipment flagged
// is_availabilty_check is excluded entirely (never real supplier cost).
const suppliersReport = catchAsync(async (req, res) => {
  const q = req.query || {};
  const page = Number(q.page || q.p || 1) || 1;
  const perPage =
    Number(q.perPage || q.per_page || q.limit || 1000) || 1000;

  const STATUS_MAP = { confirmed: 2, completed: 3 };
  const statusFilter =
    q.event_status !== undefined && q.event_status !== null && q.event_status !== ""
      ? STATUS_MAP[q.event_status] ?? Number(q.event_status)
      : null;

  const parseDateSafe = (val) => {
    if (!val) return null;
    const s = String(val).trim();
    const ddmmyyyy = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
    if (ddmmyyyy) {
      return `${ddmmyyyy[3]}-${String(ddmmyyyy[2]).padStart(2, "0")}-${String(ddmmyyyy[1]).padStart(2, "0")}`;
    }
    const iso = s.match(/^(\d{4}-\d{2}-\d{2})/);
    if (iso) return iso[1];
    return null;
  };
  const startDate = parseDateSafe(q.startDate || q.event_start_time);
  const endDate = parseDateSafe(q.endDate || q.event_end_time);
  const search = q.search ? String(q.search).trim() : "";
  // Laravel's report always scopes to a year — the current year unless one
  // is explicitly selected — independently of (and in addition to) any
  // start/end date range, so both can apply at once.
  const year = q.year ? Number(q.year) : new Date().getFullYear();

  // Shared filter fragments applied identically to both the equipment-line
  // and DJ-line queries, keyed off each query's own event-table alias.
  const buildEventFilter = (alias) => {
    const clauses = [`${alias}.event_status_id IN (2,3)`, `YEAR(${alias}.date) = ?`];
    const params = [year];
    if (statusFilter === 2 || statusFilter === 3) {
      clauses.push(`${alias}.event_status_id = ?`);
      params.push(statusFilter);
    }
    if (startDate) {
      clauses.push(`${alias}.date >= ?`);
      params.push(startDate);
    }
    if (endDate) {
      clauses.push(`${alias}.date <= ?`);
      params.push(endDate);
    }
    return { sql: clauses.join(" AND "), params };
  };

  const equipmentFilter = buildEventFilter("e");
  const djFilter = buildEventFilter("e");

  const equipmentSearchSql = search
    ? " AND (v.venue LIKE ? OR s.company_name LIKE ? OR eq.name LIKE ?)"
    : "";
  const equipmentSearchParams = search
    ? [`%${search}%`, `%${search}%`, `%${search}%`]
    : [];
  const djSearchSql = search ? " AND (v.venue LIKE ? OR u.name LIKE ?)" : "";
  const djSearchParams = search ? [`%${search}%`, `%${search}%`] : [];

  const equipmentRows = await prisma.$queryRawUnsafe(
    `
    SELECT
      ep.id,
      ep.event_id,
      ep.payment_send,
      ep.payment_date,
      ep.quantity,
      e.date,
      e.start_time,
      e.end_time,
      e.event_status_id,
      v.venue,
      eq.name AS equipment_name,
      s.company_name,
      CASE
        WHEN e.event_status_id = 2 THEN COALESCE(eq.cost_price, 0) * COALESCE(ep.quantity, 0)
        WHEN e.event_status_id = 3 THEN COALESCE(ep.cost_price, 0) * COALESCE(ep.quantity, 0)
        ELSE 0
      END AS cost_price
    FROM event_package ep
    LEFT JOIN events e ON e.id = ep.event_id
    LEFT JOIN venues v ON v.id = e.venue_id
    LEFT JOIN equipment eq ON eq.id = ep.equipment_id
    LEFT JOIN suppliers s ON s.id = eq.supplier_id
    WHERE eq.is_availabilty_check = 0
      AND ${equipmentFilter.sql}
      ${equipmentSearchSql}
    ORDER BY e.date DESC
    `,
    ...equipmentFilter.params,
    ...equipmentSearchParams,
  );

  const djRows = await prisma.$queryRawUnsafe(
    `
    SELECT
      e.id AS event_id,
      e.payment_send,
      e.payment_date,
      e.date,
      e.start_time,
      e.end_time,
      e.event_status_id,
      v.venue,
      u.name AS dj_name,
      CASE
        WHEN e.event_status_id = 3 THEN COALESCE(e.dj_cost_price_for_event, 0)
        WHEN e.event_status_id = 2 THEN COALESCE(pu.cost_price, 0)
        ELSE 0
      END AS cost_price
    FROM events e
    LEFT JOIN package_users pu ON pu.user_id = e.dj_id AND pu.package_name = e.dj_package_name
    LEFT JOIN users u ON u.id = e.dj_id
    LEFT JOIN venues v ON v.id = e.venue_id
    WHERE pu.user_id IS NOT NULL
      AND ${djFilter.sql}
      ${djSearchSql}
    ORDER BY e.date DESC
    `,
    ...djFilter.params,
    ...djSearchParams,
  );

  const mappedEquipment = (equipmentRows || []).map((r) => ({
    id: `ep-${r.id}`,
    event_id: Number(r.event_id),
    company_name: r.company_name || null,
    equipment_name: r.equipment_name || null,
    date: r.date || null,
    start_time: r.start_time || null,
    end_time: r.end_time || null,
    venue: r.venue || null,
    event_status_id: r.event_status_id != null ? Number(r.event_status_id) : null,
    cost_price: Number(r.cost_price || 0),
    quantity: r.quantity != null ? Number(r.quantity) : null,
    payment_send: r.payment_send || null,
    payment_date: r.payment_date || null,
    row_type: "equipment",
  }));

  // Separate, unfiltered DJ query for the KPI totals only — Laravel's
  // SuppliersReportController::calculateSupplierReport() totals queries
  // (totalCost/totalPaid/remaining) leftJoin package_users with NO
  // whereNotNull('package_users.user_id') filter, so a DJ row with no
  // matching package_users record still contributes its cost (falling back
  // to dj_cost_price_for_event or 0) to the totals. The row-level table
  // (djRows above) intentionally keeps the NOT NULL filter to match
  // Laravel's SuppliersReportService::getSuppliersReport() display query.
  const djTotalsRows = await prisma.$queryRawUnsafe(
    `
    SELECT
      e.id AS event_id,
      e.payment_send,
      e.event_status_id,
      CASE
        WHEN e.event_status_id = 3 THEN COALESCE(e.dj_cost_price_for_event, 0)
        WHEN e.event_status_id = 2 THEN COALESCE(pu.cost_price, 0)
        ELSE 0
      END AS cost_price
    FROM events e
    LEFT JOIN package_users pu ON pu.user_id = e.dj_id AND pu.package_name = e.dj_package_name
    LEFT JOIN users u ON u.id = e.dj_id
    LEFT JOIN venues v ON v.id = e.venue_id
    WHERE ${djFilter.sql}
      ${djSearchSql}
    `,
    ...djFilter.params,
    ...djSearchParams,
  );

  const mappedDjTotals = (djTotalsRows || []).map((r) => ({
    cost_price: Number(r.cost_price || 0),
    payment_send: r.payment_send || null,
  }));

  const mappedDj = (djRows || []).map((r) => ({
    id: `dj-${r.event_id}`,
    event_id: Number(r.event_id),
    company_name: r.dj_name || null,
    equipment_name: "DJ",
    date: r.date || null,
    start_time: r.start_time || null,
    end_time: r.end_time || null,
    venue: r.venue || null,
    event_status_id: r.event_status_id != null ? Number(r.event_status_id) : null,
    cost_price: Number(r.cost_price || 0),
    quantity: null,
    payment_send: r.payment_send || null,
    payment_date: r.payment_date || null,
    row_type: "dj",
  }));

  const merged = [...mappedEquipment, ...mappedDj].sort((a, b) => {
    const da = a.date ? new Date(a.date).getTime() : 0;
    const db = b.date ? new Date(b.date).getTime() : 0;
    return db - da;
  });

  // Stats mirror Laravel's separate, independently-computed KPI totals:
  // equipment rows come from the same filtered set the table shows, but DJ
  // rows for the totals use the unfiltered djTotalsRows (see above) so a DJ
  // with no matching package_users record still counts, matching Laravel.
  const totalsRows = [...mappedEquipment, ...mappedDjTotals];
  const totalCost = totalsRows.reduce((s, r) => s + r.cost_price, 0);
  const totalPaid = totalsRows
    .filter((r) => r.payment_send === "yes")
    .reduce((s, r) => s + r.cost_price, 0);
  const remaining = totalCost - totalPaid;

  // Event counts are independent of the row-level data (an event with no
  // supplier/DJ package lines still counts), matching Laravel's plain
  // Event::whereIn('event_status_id', [2,3])->count() — no search filter.
  const countFilter = buildEventFilter("events");
  const [{ count: totalCountRaw }] = await prisma.$queryRawUnsafe(
    `SELECT COUNT(*) AS count FROM events WHERE ${countFilter.sql}`,
    ...countFilter.params,
  );
  // "Remaining" means still-upcoming Confirmed events, matching Dashboard's
  // fixed definition — without the date >= today check this counted every
  // Confirmed event all year (including ones whose date already passed),
  // showing a different, stale number than Dashboard's live "Remaining".
  const remainingFilter = buildEventFilter("events");
  const [{ count: remainingCountRaw }] = await prisma.$queryRawUnsafe(
    `SELECT COUNT(*) AS count FROM events WHERE ${remainingFilter.sql} AND events.event_status_id = 2 AND events.date >= CURDATE()`,
    ...remainingFilter.params,
  );

  const start = (page - 1) * perPage;
  const paged = merged.slice(start, start + perPage);

  res.json(
    serializeForJson({
      success: true,
      result: paged,
      page,
      perPage,
      total: merged.length,
      stats: {
        count: Number(totalCountRaw || 0),
        remainingEvents: Number(remainingCountRaw || 0),
        totalCost,
        totalPaid,
        remaining,
      },
    }),
  );
});

const adminReport = catchAsync(async (req, res) => {
  const q = req.query || {};
  const { orderBy, take } = parseFilterSort(q);
  const page = Number(q.page || q.p || 1) || 1;
  const perPage =
    Number(q.perPage || q.per_page || q.limit || take || 1000) || take || 1000;
  const offset = (Math.max(page, 1) - 1) * Math.max(perPage, 1);

  const whereClauses = [];
  const params = [];
  const parseDateSafe = (val) => {
    if (!val) return null;
    const s = String(val).trim();

    // handle DD/MM/YYYY
    const ddmmyyyy = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
    if (ddmmyyyy) {
      return `${ddmmyyyy[3]}-${String(ddmmyyyy[2]).padStart(2, "0")}-${String(ddmmyyyy[1]).padStart(2, "0")}`;
    }

    // handle YYYY-MM-DD or ISO — strip time part, keep date only
    const iso = s.match(/^(\d{4}-\d{2}-\d{2})/);
    if (iso) return iso[1]; // "2026-04-19" — passed as string, no timezone shift

    return null;
  };

  const startDate = parseDateSafe(q.startDate || q.event_start_time);
  const endDate = parseDateSafe(q.endDate || q.event_end_time);
  // Laravel's admin report always scopes to a year — the current year unless
  // one is explicitly selected — independently of (and in addition to) any
  // start/end date range, so both can apply at once. Same `year` param name
  // as the supplier report for frontend consistency.
  const year =
    q.year !== undefined && q.year !== null && q.year !== ""
      ? Number(q.year)
      : new Date().getFullYear();
  whereClauses.push("YEAR(e.date) = ?");
  params.push(year);

  if (startDate) {
    whereClauses.push("e.date >= ?");
    params.push(startDate); // plain string "2026-04-19", MySQL handles it correctly
  }
  if (endDate) {
    whereClauses.push("e.date <= ?");
    params.push(endDate);
  }
  if (q.event_date) {
    const exactDate = parseDateSafe(q.event_date);
    if (exactDate) {
      whereClauses.push("e.date = ?");
      params.push(exactDate);
    }
  }
  const STATUS_MAP = {
    open: 1,
    confirmed: 2,
    completed: 3,
    cancelled: 4,
  };

  if (
    q.event_status !== undefined &&
    q.event_status !== null &&
    q.event_status !== ""
  ) {
    const resolvedStatus = STATUS_MAP[q.event_status] ?? Number(q.event_status);
    if (!isNaN(resolvedStatus)) {
      whereClauses.push("e.event_status_id = ?");
      params.push(resolvedStatus);
    }
  } else {
    // Laravel's AdminReportService::getAdminReport() scopes to
    // whereIn('events.event_status_id', [2, 3, 4]) — confirmed/completed/
    // cancelled, excluding Open Enquiries (status 1). Only apply this
    // default when the caller hasn't explicitly requested a status.
    whereClauses.push("e.event_status_id IN (2,3,4)");
  }
  if (q.search) {
    const s = String(q.search).trim();
    if (s) {
      whereClauses.push(
        "(u_client.name LIKE ? OR u_client.email LIKE ? OR u_client.contact_number LIKE ? OR v.venue LIKE ?)",
      );
      const like = `%${s}%`;
      params.push(like, like, like, like);
    }
  }
  if (q.venue_name) {
    whereClauses.push("v.venue LIKE ?");
    params.push(`%${String(q.venue_name).trim()}%`);
  }
  if (q.company_name) {
    whereClauses.push("c.name LIKE ?");
    params.push(`%${String(q.company_name).trim()}%`);
  }
  if (q.dj_name) {
    whereClauses.push("u_dj.name LIKE ?");
    params.push(`%${String(q.dj_name).trim()}%`);
  }

  if (
    q.total_price !== undefined &&
    q.total_price !== null &&
    q.total_price !== ""
  ) {
    whereClauses.push("CAST(e.total_cost_for_equipment AS DECIMAL(12,2)) = ?");
    params.push(Number(q.total_price));
  }
  if (q.cost !== undefined && q.cost !== null && q.cost !== "") {
    whereClauses.push("CAST(e.total_cost_for_equipment AS DECIMAL(12,2)) = ?");
    params.push(Number(q.cost));
  }
  if (
    q.extra_cost !== undefined &&
    q.extra_cost !== null &&
    q.extra_cost !== ""
  ) {
    whereClauses.push("e.extra_cost = ?");
    params.push(Number(q.extra_cost));
  }
  if (q.profit !== undefined && q.profit !== null && q.profit !== "") {
    whereClauses.push("e.profit = ?");
    params.push(Number(q.profit));
  }

  const whereSql = whereClauses.length
    ? `WHERE ${whereClauses.join(" AND ")}`
    : "";

  const sortFieldRaw =
    typeof orderBy === "object" && orderBy
      ? Object.keys(orderBy)[0]
      : undefined;
  const sortDirectionRaw =
    typeof orderBy === "object" && orderBy
      ? String(Object.values(orderBy)[0] || "desc")
      : "desc";
  const sortDirection =
    sortDirectionRaw.toLowerCase() === "asc" ? "ASC" : "DESC";
  const sortMap = {
    id: "event_id",
    date: "event_date",
    event_status_id: "event_status",
    client_name: "client_name",
    dj_name: "dj_name",
    venue_name: "venue_name",
    total_price: "total_price",
    total_cost: "total_cost",
    extra_cost: "extra_cost",
    profit: "profit",
    payment_received: "payment_received",
    payment_remaining: "payment_remaining",
  };
  const safeSortField = sortMap[sortFieldRaw] || "event_date";

  const sql = `
		WITH filtered_events AS (
			SELECT
				e.id,
				e.event_cost,
        e.event_status_id,
        es.status AS event_status,
				e.date,
				e.extra_cost,
				e.profit,
				e.dj_id,
				e.dj_package_name,
				e.dj_cost_price_for_event,
				e.total_cost_for_equipment,
				u_client.name AS client_name,
				u_dj.name AS dj_name,
				v.venue AS venue_name,
				c.name AS company_name
      FROM events e
			LEFT JOIN users u_client ON u_client.id = e.user_id
			LEFT JOIN users u_dj ON u_dj.id = e.dj_id
			LEFT JOIN venues v ON v.id = e.venue_id
			LEFT JOIN company_names c ON c.id = e.names_id
      LEFT JOIN event_statuses es ON es.id = e.event_status_id
			${whereSql}
		),
		pkg_agg AS (
			SELECT
				ep.event_id,
				SUM(
					CASE
						WHEN ep.package_type_id = 1 THEN
							(CASE WHEN fe.event_status_id IN (3,4) THEN COALESCE(ep.cost_price, 0) ELSE COALESCE(eq.cost_price, 0) END) * COALESCE(ep.quantity, 0)
						ELSE 0
					END
				) AS basic_cost_total,
				SUM(
					CASE
						WHEN ep.package_type_id = 2 THEN
							(CASE WHEN fe.event_status_id IN (3,4) THEN COALESCE(ep.cost_price, 0) ELSE COALESCE(eq.cost_price, 0) END) * COALESCE(ep.quantity, 0)
						ELSE 0
					END
				) AS extra_cost_total
			FROM event_package ep
			JOIN filtered_events fe ON fe.id = ep.event_id
			LEFT JOIN equipment eq ON eq.id = ep.equipment_id
			GROUP BY ep.event_id
		),
		payments_agg AS (
			SELECT event_id, SUM(COALESCE(amount, 0)) AS payment_received
			FROM event_payments
			WHERE event_id IN (SELECT id FROM filtered_events)
			GROUP BY event_id
		),
		dj_pkg AS (
			SELECT user_id, package_name, MAX(COALESCE(cost_price, 0)) AS cost_price
			FROM package_users
			GROUP BY user_id, package_name
		),
		final_rows AS (
			SELECT
				fe.company_name,
				fe.client_name,
                fe.date AS event_date,
                fe.event_status_id AS event_status_id,
                fe.event_status AS event_status,
				fe.dj_name,
				fe.venue_name,
				COALESCE(
					fe.event_cost,
					COALESCE(pa.basic_cost_total, 0) + COALESCE(pa.extra_cost_total, 0) +
					(CASE WHEN fe.event_status_id IN (3,4) THEN COALESCE(fe.dj_cost_price_for_event, 0) ELSE COALESCE(dp.cost_price, 0) END),
					0
				) AS total_price,
				(
					COALESCE(pa.basic_cost_total, 0) + COALESCE(pa.extra_cost_total, 0) +
					(CASE WHEN fe.event_status_id IN (3,4) THEN COALESCE(fe.dj_cost_price_for_event, 0) ELSE COALESCE(dp.cost_price, 0) END)
				) AS total_cost,
				COALESCE(fe.extra_cost, 0) AS extra_cost,
				COALESCE(fe.profit, 0) AS profit,
				COALESCE(pay.payment_received, 0) AS payment_received,
				(
					COALESCE(
						fe.event_cost,
						COALESCE(pa.basic_cost_total, 0) + COALESCE(pa.extra_cost_total, 0) +
						(CASE WHEN fe.event_status_id IN (3,4) THEN COALESCE(fe.dj_cost_price_for_event, 0) ELSE COALESCE(dp.cost_price, 0) END),
						0
					) - COALESCE(pay.payment_received, 0)
				) AS payment_remaining,
				fe.id AS event_id,
				COUNT(*) OVER() AS total_count,
				SUM(CASE WHEN fe.date >= CURDATE() THEN 1 ELSE 0 END) OVER() AS remaining_events_count
			FROM filtered_events fe
			LEFT JOIN pkg_agg pa ON pa.event_id = fe.id
			LEFT JOIN payments_agg pay ON pay.event_id = fe.id
			LEFT JOIN dj_pkg dp ON dp.user_id = fe.dj_id AND dp.package_name = fe.dj_package_name
		)
      SELECT
			company_name,
			client_name,
			event_date,
        event_status_id,
        event_status,
			dj_name,
			venue_name,
			total_price,
			total_cost,
			extra_cost,
			profit,
			payment_received,
			payment_remaining,
			total_count,
			remaining_events_count,
			-- Window aggregates over the FULL filtered result set (evaluated
			-- before the LIMIT/OFFSET below, same as total_count above) — the
			-- KPI cards must reflect every matching event, not just the current
			-- page. Summing the paginated JS rows instead (the previous
			-- approach) silently understated these whenever perPage < total
			-- matching events, e.g. the default 10-per-page admin report view
			-- showing totals for 10 events while "Events" correctly showed 571.
			SUM(total_cost) OVER() AS total_cost_sum,
			SUM(payment_received) OVER() AS total_paid_sum,
			event_id
		FROM final_rows
		ORDER BY ${safeSortField} ${sortDirection}, event_id DESC
		LIMIT ? OFFSET ?
	`;

  const rows = await prisma.$queryRawUnsafe(
    sql,
    ...params,
    Math.max(perPage, 1),
    offset,
  );

  const data = (rows || []).map((r) => ({
    event_id: Number(r.event_id),
    company_name: r.company_name || null,
    client_name: r.client_name || null,
    event_date: r.event_date || null,
    event_status_id: r.event_status_id || null,
    event_status: r.event_status || null,
    dj_name: r.dj_name || null,
    venue_name: r.venue_name || null,
    total_price: Number(r.total_price || 0),
    total_cost: Number(r.total_cost || 0),
    extra_cost: Number(r.extra_cost || 0),
    profit: Number(r.profit || 0),
    payment_received: Number(r.payment_received || 0),
    payment_remaining: Number(r.payment_remaining || 0),
  }));

  const totalEvents =
    rows && rows.length ? Number(rows[0].total_count || 0) : 0;
  const remainingEvents =
    rows && rows.length ? Number(rows[0].remaining_events_count || 0) : 0;
  // Read from the window-aggregate columns (see the SQL above), NOT a JS
  // reduce over `data` — `data` is only the current page's rows, and the KPI
  // cards need the total across every event matching the active filters.
  const totalCost =
    rows && rows.length ? Number(rows[0].total_cost_sum || 0) : 0;
  const totalPaid =
    rows && rows.length ? Number(rows[0].total_paid_sum || 0) : 0;
  const remaining = totalCost - totalPaid;

  res.json(
    serializeForJson({
      success: true,
      result: data,
      page,
      perPage,
      total: totalEvents,
      stats: {
        count: totalEvents,
        remainingEvents,
        totalCost,
        totalPaid,
        remaining,
      },
    }),
  );
});

// Admin Report's "Extra Cost" inline edit — matches Laravel's
// AdminReportService::createExtraCostReport() exactly: the client sends back
// the row's current `cost` (total_cost) and `totalCost` (total_price)
// alongside the new extra_cost, and profit is recomputed from those —
// same trust-the-client-for-the-rest-of-the-row approach Laravel uses,
// since this is a single-cell edit, not a full event recalculation.
// Blocked for Cancelled events (status 4) on the frontend, matching
// Laravel's dbl-click block there.
const updateAdminReportRow = catchAsync(async (req, res) => {
  const id = Number(req.params.id);
  const body = req.body || {};
  const extraCost = Number(body.extra_cost || 0);
  const cost = Number(body.cost || 0);
  const totalCost = Number(body.totalCost || 0);
  const cancelDepositAmount = Number(body.canceldeopsitAmount || 0);

  const event = await prisma.event.findUnique({ where: { id }, select: { event_status_id: true, extra_cost: true, profit: true } });
  if (!event) return res.status(404).json({ error: "event_not_found" });

  const overAllCost = extraCost + cost + (Number(event.event_status_id) === 4 ? cancelDepositAmount : 0);
  const profit = totalCost - overAllCost;

  const updated = await prisma.event.update({
    where: { id },
    data: { extra_cost: extraCost, profit },
  });

  await logActivity(prisma, {
    log_name: "event costs adjusted",
    description: `Extra cost/profit adjusted on event #${id}`,
    subject_type: "Event",
    subject_id: id,
    causer_id: req.user?.id || null,
    properties: {
      old_extra_cost: event.extra_cost,
      new_extra_cost: extraCost,
      old_profit: event.profit,
      new_profit: profit,
    },
  });

  res.json(serializeForJson({ success: true, data: updated }));
});

// Equipment-line payment toggle — updates event_package.payment_send/date,
// matching Laravel's SuppliersReportService::createSupplierReport(). id is
// the event_package row id (the "ep-<id>" row from suppliersReport above).
const updateSupplierPaymentEquipment = catchAsync(async (req, res) => {
  const id = Number(req.params.id);
  const { payment_send, payment_date } = req.body || {};
  // EventPackage.id is a BigInt column.
  const updated = await prisma.eventPackage.update({
    where: { id: BigInt(id) },
    data: {
      payment_send: payment_send ?? null,
      payment_date: payment_date ? new Date(payment_date) : null,
    },
  });

  await logActivity(prisma, {
    log_name: "supplier payment marked",
    description: `Supplier payment marked for event_package #${id}`,
    subject_type: "EventPackage",
    subject_id: id,
    causer_id: req.user?.id || null,
    properties: { payment_send: payment_send ?? null, payment_date: payment_date ?? null },
  });

  res.json(serializeForJson({ success: true, data: updated }));
});

// DJ-line payment toggle — updates events.payment_send/date, matching
// Laravel's SuppliersReportService::createSupplierReportIndj(). id is the
// event id (the "dj-<event_id>" row from suppliersReport above).
const updateSupplierPaymentDj = catchAsync(async (req, res) => {
  const id = Number(req.params.id);
  const { payment_send, payment_date } = req.body || {};
  const updated = await prisma.event.update({
    where: { id },
    data: {
      payment_send: payment_send ?? null,
      payment_date: payment_date ? new Date(payment_date) : null,
    },
  });

  await logActivity(prisma, {
    log_name: "dj payment marked",
    description: `DJ payment marked for event #${id}`,
    subject_type: "Event",
    subject_id: id,
    causer_id: req.user?.id || null,
    properties: { payment_send: payment_send ?? null, payment_date: payment_date ?? null },
  });

  res.json(serializeForJson({ success: true, data: updated }));
});

export default {
  suppliersReport,
  adminReport,
  updateAdminReportRow,
  updateSupplierPaymentEquipment,
  updateSupplierPaymentDj,
};
