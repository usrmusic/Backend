import prisma from "../utils/prismaClient.js";
import catchAsync from "../utils/catchAsync.js";
import { serializeForJson } from "../utils/serialize.js";
import { parseFilterSort } from "../utils/queryHelpers.js";
import services from "../services/index.js";

const eventSvc = services.get("event");

const suppliersReport = catchAsync(async (req, res) => {
  const q = req.query || {};
  const { where: baseWhere = {}, orderBy, take, skip } = parseFilterSort(q);
  const page = Number(q.page || q.p || 1) || 1;
  const perPage =
    Number(q.perPage || q.per_page || q.limit || take || 1000) || take || 1000;
  const supplierId = Number(q.supplier_id);

  const STATUS_MAP = {
    confirmed: 2,
    completed: 3,
  };

  const rawStatus = q.event_status;
  const resolvedStatus =
    rawStatus !== undefined && rawStatus !== null && rawStatus !== ""
      ? (STATUS_MAP[rawStatus] ?? Number(rawStatus))
      : undefined;

  // Merge supplier filter into event where clause
  const where = { ...baseWhere };
  if (supplierId) {
    where.event_package = { some: { equipment: { supplier_id: supplierId } } };
  }

  if (resolvedStatus !== undefined && !isNaN(resolvedStatus)) {
    where.event_status_id = resolvedStatus;
  }
  // Additional filters from validation
  // search (also accept `search` in addition to `q` handled by parseFilterSort)
  if (q.search) {
    const s = String(q.search).trim();
    if (s) {
      where.OR = where.OR || [];
      where.OR.push(
        { usr_name: { contains: s } },
        { venues: { is: { venue: { contains: s } } } },
        {
          users_events_user_idTousers: {
            is: {
              OR: [
                { name: { contains: s } },
                { email: { contains: s } },
                { contact_number: { contains: s } },
              ],
            },
          },
        },
      );
    }
  }

  // date range filters
  if (q.startDate || q.endDate) {
    where.date = where.date || {};
    if (q.startDate) where.date.gte = new Date(q.startDate);
    if (q.endDate) where.date.lte = new Date(q.endDate);
  }
  if (q.year) {
    where.date = where.date || {};
    where.date.gte = new Date(`${q.year}-01-01`);
    where.date.lte = new Date(`${q.year}-12-31`);
  }
  if (q.event_date) {
    // match exact date
    where.date = new Date(q.event_date);
  }

  // time filters (accept either a time like '20:00' OR a date like '20/12/2025' or ISO)
  if (q.event_start_time || q.event_end_time) {
    const parseTimeOrDate = (val) => {
      if (!val) return null;
      const s = String(val).trim();
      // time pattern HH:mm or HH:mm:ss
      if (/^\d{1,2}:\d{2}(:\d{2})?$/.test(s)) {
        const d = new Date(`1970-01-01T${s}`);
        return isNaN(d) ? null : { type: "time", value: d };
      }
      // try ISO or JS-parsable date
      const iso = new Date(s);
      if (!isNaN(iso)) return { type: "date", value: iso };
      // try DD/MM/YYYY
      const m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
      if (m) {
        const dd = Number(m[1]);
        const mm = Number(m[2]) - 1;
        const yyyy = Number(m[3]);
        const d = new Date(yyyy, mm, dd);
        if (!isNaN(d)) return { type: "date", value: d };
      }
      return null;
    };

    const startParsed = parseTimeOrDate(q.event_start_time);
    const endParsed = parseTimeOrDate(q.event_end_time);

    // if either parsed value is a date, set date range instead
    if (
      (startParsed && startParsed.type === "date") ||
      (endParsed && endParsed.type === "date")
    ) {
      where.date = where.date || {};
      if (startParsed && startParsed.type === "date")
        where.date.gte = startParsed.value;
      if (endParsed && endParsed.type === "date")
        where.date.lte = endParsed.value;
    } else {
      // otherwise use start_time range (time-of-day)
      where.start_time = where.start_time || {};
      if (startParsed && startParsed.type === "time")
        where.start_time.gte = startParsed.value;
      if (endParsed && endParsed.type === "time")
        where.start_time.lte = endParsed.value;
    }
  }

  // venue name
  if (q.venue_name) {
    where.venues = { is: { venue: { contains: String(q.venue_name) } } };
  }

  // cost (match event.total_cost_for_equipment)
  if (q.cost !== undefined && q.cost !== null && q.cost !== "") {
    where.total_cost_for_equipment = String(q.cost);
  }

  // package-related filters: quantity, payment_send, supplier_name
  if (q.quantity || q.payment_send !== undefined || q.supplier_name) {
    const pkgSome =
      where.event_package && where.event_package.some
        ? { ...where.event_package.some }
        : {};
    if (q.quantity) pkgSome.quantity = Number(q.quantity);
    if (q.payment_send !== undefined) {
      // filter packages that have a non-null payment_send when true, or null when false
      if (String(q.payment_send) === "true" || q.payment_send === true)
        pkgSome.payment_send = { not: null };
      else pkgSome.payment_send = null;
    }
    if (q.supplier_name) {
      pkgSome.equipment = pkgSome.equipment || {};
      pkgSome.equipment.suppliers = {
        is: { name: { contains: String(q.supplier_name) } },
      };
    }
    where.event_package = { some: pkgSome };
  }

  // payment_date filter (events that have payments on that date)
  if (q.payment_date) {
    where.event_payments = {
      some: { date: { equals: new Date(q.payment_date) } },
    };
  }

  // select base event fields
  const events = await eventSvc.list({
    filter: where,
    select: {
      id: true,
      usr_name: true,
      date: true,
      start_time: true,
      end_time: true,
    venues: { select: { id: true, venue: true } },
    event_statuses: { select: { id: true, status: true } },
      // include DJ relation so we can return the DJ name from dj_id
      users_events_dj_idTousers: { select: { id: true, name: true } },
      dj_id: true,
      dj_package_name: true,
      total_cost_for_equipment: true,
      user_id: true,
      names_id: true,
      event_status_id: true,
      payment_send: true,
      payment_date: true,
    },
    sort:
      typeof orderBy === "object"
        ? Object.keys(orderBy)[0] + ":" + Object.values(orderBy)[0]
        : undefined,
    page,
    perPage,
  });

  const eventIds = events.map((e) => e.id);

  // fetch related packages for those events
  const packages = eventIds.length
    ? await prisma.eventPackage.findMany({
        where: { event_id: { in: eventIds } },
        select: {
          id: true,
          event_id: true,
          equipment_order_id: true,
          cost_price: true,
          payment_send: true,
          payment_date: true,
          quantity: true,
          equipment: {
            select: {
              id: true,
              name: true,
              equipment_properties: {
                select: {
                  id: true,
                  value: true,
                  properties: { select: { id: true, name: true } },
                },
              },
            },
          },
          package_types: { select: { id: true, type: true } },
        },
      })
    : [];

  // fetch event payments for those events
  const payments = eventIds.length
    ? await prisma.eventPayment.findMany({
        where: { event_id: { in: eventIds } },
        select: { id: true, event_id: true, amount: true, date: true },
      })
    : [];

  // compute cost per event (prefer event.total_cost_for_equipment, fallback to packages)
  const costRows = eventIds.length
    ? await prisma.event.findMany({
        where: { id: { in: eventIds } },
        select: { id: true, total_cost_for_equipment: true },
      })
    : [];

  const costByEvent = new Map(
    costRows.map((r) => [
      Number(r.id),
      Number(r.total_cost_for_equipment || 0),
    ]),
  );

  // build packagesByEvent and paymentsByEvent maps to avoid repeated filtering
  const packagesByEvent = new Map();
  for (const p of packages) {
    const id = Number(p.event_id);
    if (!packagesByEvent.has(id)) packagesByEvent.set(id, []);
    packagesByEvent.get(id).push(p);
  }

  const paymentsByEvent = new Map();
  for (const p of payments) {
    const id = Number(p.event_id);
    paymentsByEvent.set(
      id,
      (paymentsByEvent.get(id) || 0) + Number(p.amount || 0),
    );
  }

  // fetch company names for events that reference names_id
  const companyIds = Array.from(
    new Set(events.map((e) => e.names_id).filter(Boolean)),
  ).map((id) => BigInt(id));
  const companies = companyIds.length
    ? await prisma.companyName.findMany({
        where: { id: { in: companyIds } },
        select: { id: true, name: true },
      })
    : [];

  const companyById = new Map(companies.map((c) => [String(c.id), c]));

  // assemble final payload
  const data = events.map((ev) => {
    const evPackages = packagesByEvent.get(Number(ev.id)) || [];

    // flatten requirement (equipment names) and total quantity for parity with Laravel report
    const requirement =
      evPackages
        .map((p) => p.equipment?.name || null)
        .filter(Boolean)
        .join(", ") || null;
    const totalQuantity = evPackages.length
      ? evPackages.reduce((s, p) => s + Number(p.quantity || 0), 0)
      : null;

    const company = ev.names_id
      ? companyById.get(String(BigInt(ev.names_id)))
      : null;

    // payments for this event (sum from map)
    const totalPaidForEvent = paymentsByEvent.get(Number(ev.id)) || 0;
    // latest payment date still requires scanning payments array (rare) — compute quickly
    const latestPaymentDate = (() => {
      const arr = payments.filter((p) => Number(p.event_id) === Number(ev.id));
      return arr.length
        ? arr.reduce((a, b) => (a.date > b.date ? a : b)).date
        : null;
    })();

    // compute per-event total cost: prefer event.total_cost_for_equipment, fallback to summing package cost_price * quantity
    const eventLevelCost = Number(costByEvent.get(Number(ev.id)) || 0);
    const packageFallbackCost = evPackages.reduce(
      (s, p) => s + Number(p.cost_price || 0) * Number(p.quantity || 0),
      0,
    );
    const totalCostForEvent =
      eventLevelCost > 0 ? eventLevelCost : packageFallbackCost;

    return {
      event_id: ev.id,
      name: ev.usr_name || null,
      dj_name: ev.users_events_dj_idTousers?.name || null,
      date: ev.date || null,
      start_time: ev.start_time || null,
      end_time: ev.end_time || null,
      venue: ev.venues?.venue || null,
      dj_package_name: ev.dj_package_name || null,
      user_id: ev.user_id || null,
      event_status_id: ev.event_status_id || null,
      event_status: ev.event_statuses?.status || null,
      payment_send: ev.payment_send || null,
      payment_received: totalPaidForEvent,
      payment_date: latestPaymentDate || null,
      // top-level requirement + quantity (flattened)
      requirement: requirement,
      quantity: totalQuantity,
      total_cost: totalCostForEvent,
      company_name: company ? company.name : null,
      // event_packages: mappedPackages,
    };
  });

  // statistics
  const today = new Date();
  const totalEvents = await eventSvc.model.count({ where });
  const remainingEvents = await eventSvc.model.count({
    where: { ...where, date: { gte: today } },
  });

  // total cost (sum event.total_cost_for_equipment, fallback to package totals) — use packagesByEvent
  let totalCost = 0;
  for (const id of eventIds) {
    const c = Number(costByEvent.get(Number(id)) || 0);
    if (c > 0) {
      totalCost += c;
      continue;
    }
    const pkgs = packagesByEvent.get(Number(id)) || [];
    for (const p of pkgs) {
      totalCost += (Number(p.cost_price) || 0) * (Number(p.quantity) || 0);
    }
  }

  const totalPaid = payments.reduce((s, r) => s + Number(r.amount || 0), 0);
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
    confirmed: 2,
    completed: 3,
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
  const totalCost = data.reduce((s, r) => s + Number(r.total_cost || 0), 0);
  const totalPaid = data.reduce(
    (s, r) => s + Number(r.payment_received || 0),
    0,
  );
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

export default { suppliersReport, adminReport };
