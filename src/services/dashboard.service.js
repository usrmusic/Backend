import prisma from '../utils/prismaClient.js';
import { parseNumberLike, parseSearchDate } from '../utils/helpers.js';

const MONTH_LABELS = [
	'Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'
];

// async function getDashboardStats({ year = null } = {}) {
// 	const now = new Date();
// 	const targetYear = year || now.getFullYear();
// 	const startOfYear = new Date(targetYear, 0, 1);
// 	const endOfYear = new Date(targetYear, 11, 31, 23, 59, 59);

// 	// fetch events in the year once and aggregate in-memory to minimize DB roundtrips
// 	const events = await prisma.event.findMany({
// 		where: { date: { gte: startOfYear, lte: endOfYear } },
// 		select: {
// 				id: true,
// 				date: true,
// 				profit: true,
// 				event_status_id: true,
// 				dj_id: true,
// 				couple_name: true,
// 				is_event_payment_fully_paid: true,
// 				event_amount_without_vat: true,
// 				event_cost: true,
// 				users_events_dj_idTousers: { select: { id: true, name: true } },
// 				event_statuses: { select: { id: true, status: true } },
// 			},
// 	});

// 	// totals
// 	const totalEvents = events.length;
// 	const totalProfit = events.reduce((s, e) => s + parseNumberLike(e.profit), 0);

// 	// monthly overview
// 	const monthlyCounts = new Array(12).fill(0);
// 	const monthlyProfits = new Array(12).fill(0);
// 	events.forEach((e) => {
// 		if (!e.date) return;
// 		const d = new Date(e.date);
// 		const m = d.getMonth();
// 		monthlyCounts[m] += 1;
// 		monthlyProfits[m] += parseNumberLike(e.profit);
// 	});

// 	// sales analytics: counts by status and DJ distribution
// 	const statusCounts = {};
// 	const djCounts = {};
// 	for (const e of events) {
// 		// Prefer human-readable status name when available
// 		const stName = e.event_statuses && e.event_statuses.status ? String(e.event_statuses.status) : String(e.event_status_id || 'unknown');
// 		statusCounts[stName] = (statusCounts[stName] || 0) + 1;

// 		// Prefer DJ name when available
// 		const djName = e.users_events_dj_idTousers && e.users_events_dj_idTousers.name ? String(e.users_events_dj_idTousers.name) : (e.dj_id ? String(e.dj_id) : 'unassigned');
// 		djCounts[djName] = (djCounts[djName] || 0) + 1;
// 	}

// 	// pending payments (across DB) - top events where payment not fully paid
// 	const pendingPayments = await prisma.event.findMany({
// 		where: { is_event_payment_fully_paid: false },
// 		select: {
// 			id: true,
// 			couple_name: true,
// 			deposit_amount: true,
// 			payment_date: true,
// 			is_event_payment_fully_paid: true,
//  			event_payments: { select: { amount: true } },
//  			users_events_user_idTousers: { select: { id: true, name: true, email: true } },
			
// 		},
// 		orderBy: { date: 'asc' },
// 		take: 50,
// 	});

// 	const pending = pendingPayments.map((p) => {
// 		const paid = (p.event_payments || []).reduce((s, it) => s + parseNumberLike(it.amount), 0);
// 		const expected = parseNumberLike(p.deposit_amount) || 0;
// 		const clientName = p.users_events_user_idTousers?.name || null;
// 		return { id: p.id, couple_name: p.couple_name, client_name: clientName, expected, paid, outstanding: Math.max(0, expected - paid), payment_date: p.payment_date };
// 	});

// 	// open enquiries: attempt to match statuses that look like enquiry
// 	const openEnquiries = await prisma.event.findMany({
// 		where: { event_statuses: { status: { contains: 'enquiry' } } },
// 		select: { id: true, couple_name: true, date: true },
// 		orderBy: { date: 'desc' },
// 		take: 50,
// 	});

// 	// counts
// 	const openEnquiriesCount = await prisma.event.count({ where: { event_statuses: { status: { contains: 'enquiry' } } } });
// 	const confirmedEventsCount = await prisma.event.count({ where: { event_statuses: { status: { contains: 'confirm' } } } });

// 	// calendar events: events for current month
// 	const curStart = new Date(now.getFullYear(), now.getMonth(), 1);
// 	const curEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59);
// 	const calendarEvents = await prisma.event.findMany({
// 		where: { date: { gte: curStart, lte: curEnd } },
// 		select: { id: true, date: true, couple_name: true },
// 		orderBy: { date: 'asc' },
// 		take: 200,
// 	});

// 	// recent notes
// 	const notes = await prisma.eventNote.findMany({
// 		orderBy: { created_at: 'desc' },
// 		take: 10,
// 		select: { id: true, event_id: true, notes: true, created_at: true, created_by: true },
// 	});

// 	return {
// 		year: targetYear,
// 		totalEvents,
// 		openEnquiriesCount,
// 		confirmedEventsCount,
// 		totalProfit,
// 		monthly: {
// 			labels: MONTH_LABELS,
// 			counts: monthlyCounts,
// 			profits: monthlyProfits,
// 		},
// 		salesAnalytics: { statusCounts, djCounts },
// 		pendingPayments: pending,
// 		openEnquiries,
// 		calendarEvents,
// 		recentNotes: notes,
// 	};
// }

async function getDashboardStats({ year = null, userId = null, scope = 'admin', userRoleId = null } = {}) {
    const now = new Date();
    const targetYear = year || now.getFullYear();
    const startOfYear = new Date(targetYear, 0, 1);
    const endOfYear = new Date(targetYear, 11, 31, 23, 59, 59);

    // Reusable date filter for the selected year
    const dateFilter = { gte: startOfYear, lte: endOfYear };

    /**
     * 1. Primary Fetch: Get all main event data for the year.
     * We process these in-memory to avoid 12+ separate DB calls.
     */
    // Build scope-aware where clause
    let baseWhere = { date: dateFilter };

    if (scope === 'team') {
        // Match by THIS user's id, never by role — matching on role_id would
        // pull in every other Staff member's events too (any DJ with the
        // same role), not just events actually assigned to this user.
        const teamOr = [];
        if (userId) {
            teamOr.push({ dj_id: userId });
            teamOr.push({ created_by: userId });
        }
        if (teamOr.length) baseWhere = { AND: [baseWhere, { OR: teamOr }] };
    } else if (scope === 'personal') {
        const personalOr = [];
        if (userId) {
            personalOr.push({ user_id: userId });
            personalOr.push({ dj_id: userId });
            personalOr.push({ created_by: userId });
        }
        if (personalOr.length) baseWhere = { AND: [baseWhere, { OR: personalOr }] };
    }

    const events = await prisma.event.findMany({
        where: baseWhere,
        select: {
            id: true,
            date: true,
            profit: true,
            event_status_id: true,
            dj_id: true,
            couple_name: true,
            is_event_payment_fully_paid: true,
            event_amount_without_vat: true,
            total_cost_for_equipment: true,
            vat_value: true,
            event_cost: true,
            users_events_dj_idTousers: { select: { id: true, name: true } },
            event_statuses: { select: { id: true, status: true } },
        },
    });

    // --- In-Memory Aggregations (Turnover, Profit, Monthly) ---
    let totalProfit = 0;
    let totalTurnover = 0;

    const monthlyCounts = new Array(12).fill(0);
    const monthlyProfits = new Array(12).fill(0);
    const monthlyTurnover = new Array(12).fill(0);

    const statusCounts = {};
    const djCounts = {};

    const confirmedCompletedEvents = events.filter((e) => [2, 3].includes(e.event_status_id));
    // "Events" stat card matches Laravel's confirmAndCompletedEvents count —
    // confirmed + completed only, not every event in the year (open enquiries
    // and cancelled events were inflating this number before).
    const totalEvents = confirmedCompletedEvents.length;
    confirmedCompletedEvents.forEach((e) => {
        const netAmount = parseNumberLike(e.total_cost_for_equipment);
        const profitAmount = parseNumberLike(e.profit);

        totalTurnover += netAmount;
        totalProfit += profitAmount;

        if (e.date) {
            const m = new Date(e.date).getMonth();
            monthlyTurnover[m] += netAmount;
        }
    });

    events.forEach((e) => {
        if (e.date) {
            const m = new Date(e.date).getMonth();
            monthlyCounts[m] += 1;
            // Only confirmed/completed events count toward profit — matches the
            // filter used for totalProfit above. Without this gate, stale `profit`
            // values left on Open Enquiry / Cancelled events (verified live: 10
            // open + 44 cancelled events carrying a combined £220,030) leaked into
            // the monthly chart while the year-total KPI correctly excluded them,
            // so the chart and the headline number could never reconcile.
            if ([2, 3].includes(e.event_status_id)) {
                monthlyProfits[m] += parseNumberLike(e.profit);
            }
        }

        const stName = e.event_statuses?.status ? String(e.event_statuses.status) : String(e.event_status_id || 'unknown');
        statusCounts[stName] = (statusCounts[stName] || 0) + 1;
    });

    // "Top performing DJs" must reflect real gigs only (confirmed/completed) —
    // counting open enquiries or cancelled events here would inflate a DJ's
    // gig count with work that never actually happened.
    confirmedCompletedEvents.forEach((e) => {
        const djName = e.users_events_dj_idTousers?.name ? String(e.users_events_dj_idTousers.name) : (e.dj_id ? String(e.dj_id) : 'unassigned');
        djCounts[djName] = (djCounts[djName] || 0) + 1;
    });
    // Deliberate departure from Laravel (Laravel's confirmEnquiryEvents has
    // no date filter at all) — by request, "Remaining" here means Confirmed
    // events that haven't happened yet. Compared at day granularity (not
    // exact timestamp) so a same-day event still counts as remaining, and so
    // this matches Suppliers Report's CURDATE()-based version exactly (see
    // reports.controller.js's remainingCountRaw) — the two must use the same
    // day-boundary rule or they disagree by exactly the events dated today.
    const todayForRemaining = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const confirmedEventsCount = events.filter(
        (e) =>
            e.event_status_id === 2 &&
            e.date &&
            new Date(e.date) >= todayForRemaining
    ).length;

    // Open Enquiries count must match the real Open Enquiry list page exactly —
    // that page has NO year/date filter (an open enquiry usually has no event
    // date set yet), so counting from the year-scoped `events` array above
    // silently dropped most of them. Mirrors enquiry.controller.js's own
    // scoping: Staff (role 3) sees only their own, Client (role 4) sees only
    // theirs, Admin/Super Admin see the global total.
    let openEnquiryWhere = { event_status_id: 1 };
    if (Number(userRoleId) === 3) {
        openEnquiryWhere = { AND: [openEnquiryWhere, { OR: [{ dj_id: userId }, { created_by: userId }] }] };
    } else if (Number(userRoleId) === 4) {
        openEnquiryWhere = { AND: [openEnquiryWhere, { OR: [{ user_id: userId }, { dj_id: userId }, { created_by: userId }] }] };
    }
    const openEnquiriesCount = await prisma.event.count({ where: openEnquiryWhere });

    /**
     * 2. Secondary Queries: Executed in parallel via Promise.all
     */
    // Pending Payments — matches Laravel's DashboardController exactly:
    // ALL unpaid Completed events (event_status_id=3, no date limit) plus
    // unpaid Confirmed events (event_status_id=2) due in the next 4 weeks.
    // No year filter and no role scoping in Laravel — every role sees the
    // same global list — so this deliberately ignores `dateFilter`/`baseWhere`.
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const fourWeeksOut = new Date(today);
    fourWeeksOut.setDate(fourWeeksOut.getDate() + 28);
    const pendingPaymentSelect = {
        id: true,
        couple_name: true,
        total_cost_for_equipment: true,
        date: true,
        event_status_id: true,
        event_payments: { select: { amount: true } },
        users_events_user_idTousers: { select: { id: true, name: true, email: true } },
    };

    const [completedUnpaid, confirmedUnpaid, cancelDepositEvents, openEnquiries, calendarEvents, recentNotes] = await Promise.all([
        prisma.event.findMany({
            where: { event_status_id: 3, is_event_payment_fully_paid: false },
            select: pendingPaymentSelect,
            orderBy: { date: 'asc' },
        }),
        prisma.event.findMany({
            where: {
                event_status_id: 2,
                is_event_payment_fully_paid: false,
                date: { gt: today, lte: fourWeeksOut },
            },
            select: pendingPaymentSelect,
            orderBy: { date: 'asc' },
        }),
        // Cancelled events deposit/refund totals
        prisma.event.findMany({
            where: { event_status_id: 4, date: dateFilter },
            select: {
                id: true,
                refund_amount: true,
                event_payments: { select: { amount: true } },
            },
        }),
        // Open Enquiries List — no year filter, matching openEnquiriesCount
        // above and Laravel's own open-enquiry widget query (an open enquiry
        // usually has no event date yet, so year-scoping this dropped most
        // of them).
        prisma.event.findMany({
            where: (scope === 'admin') ? { event_statuses: { status: { contains: 'open' } } } : { AND: [{ event_statuses: { status: { contains: 'open' } } }, baseWhere] },
            select: {
                id: true,
                couple_name: true,
                date: true,
                users_events_dj_idTousers: { select: { id: true, name: true } },
                users_events_user_idTousers: { select: { id: true, name: true } },
                venues: { select: { venue: true } },
            },
            orderBy: { date: 'desc' },
            take: 50,
        }),
        // Confirmed Calendar Events
        prisma.event.findMany({
            where: (scope === 'admin') ? { event_statuses: { status: { contains: 'confirm' } }, date: dateFilter } : { AND: [{ event_statuses: { status: { contains: 'confirm' } }, date: dateFilter }, baseWhere] },
            select: {
                id: true,
                date: true,
                couple_name: true,
                venues: { select: { venue: true } },
                // `color` drives the DJ's chip colour on the dashboard calendar.
                users_events_dj_idTousers: { select: { id: true, name: true, color: true } },
            },
            orderBy: { date: 'asc' },
            take: 200,
        }),
        // Notes related to this year's events
        prisma.eventNote.findMany({
            where: { event_id: { in: events.map(e => e.id) } }, // Only notes for events fetched above
            orderBy: { created_at: 'desc' },
            take: 10,
            select: { id: true, event_id: true, notes: true, created_at: true, created_by: true },
        })
    ]);

    // Map pending payments to include outstanding balance. "Expected" is
    // total_cost_for_equipment, not deposit_amount — matches the formula
    // Laravel actually uses to set is_event_payment_fully_paid
    // (total_cost_for_equipment === SUM(event_payments.amount)).
    // Completed-unpaid rows come first, then confirmed-unpaid — the two lists
    // are concatenated, not globally re-sorted, matching Laravel's behaviour.
    const pendingPayments = [...completedUnpaid, ...confirmedUnpaid].map((p) => {
        const paid = (p.event_payments || []).reduce((s, it) => s + parseNumberLike(it.amount), 0);
        const expected = parseNumberLike(p.total_cost_for_equipment) || 0;
        return {
            id: p.id,
            couple_name: p.couple_name,
            client_name: p.users_events_user_idTousers?.name || null,
            expected,
            paid,
            outstanding: Math.max(0, expected - paid),
            date: p.date,
            event_status_id: p.event_status_id
        };
    });

    const depositAmount = cancelDepositEvents.reduce((sum, e) => {
        const paid = (e.event_payments || []).reduce((s, it) => s + parseNumberLike(it.amount), 0);
        return sum + paid;
    }, 0);

    const cancelRefundPrice = cancelDepositEvents.reduce((sum, e) => sum + parseNumberLike(e.refund_amount), 0);
    const cancelOveraAllProfit = depositAmount - cancelRefundPrice;
    totalTurnover += cancelOveraAllProfit;
    totalProfit += cancelOveraAllProfit;

    return {
        year: targetYear,
        totalEvents,
        openEnquiriesCount,
        confirmedEventsCount,
        totalTurnover,
        totalProfit,
        monthly: {
            labels: ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"],
            counts: monthlyCounts,
            profits: monthlyProfits,
            turnover: monthlyTurnover,
        },
        salesAnalytics: { statusCounts, djCounts },
        pendingPayments,
        openEnquiries,
        calendarEvents,
        recentNotes
    };
}



async function getUpcomingEvents({ search = null, userId = null, scope = 'admin', userRoleId = null, allowCompleted = true, allowedStatusFilters = [] } = {}) {
    const today = new Date();
    const startDate = new Date(today.getFullYear(), today.getMonth(), today.getDate());

    // upcoming events: include all statuses except Cancelled, filter by date only
    const baseWhere = { date: { gte: startDate }, NOT: { event_statuses: { status: { contains: 'cancel' } } } };

    // prepare scope clause for upcoming events
    let roleIdBig = undefined;
    try { if (userRoleId !== null && userRoleId !== undefined) roleIdBig = typeof userRoleId === 'bigint' ? userRoleId : BigInt(userRoleId); } catch (e) { roleIdBig = undefined; }

    let where = baseWhere;
    if (scope === 'team') {
        // Match by THIS user's id, never by role — matching on role_id would
        // pull in every other Staff member's events too (any DJ with the
        // same role), not just events actually assigned to this user.
        const teamOr = [];
        if (userId) {
            teamOr.push({ dj_id: userId });
            teamOr.push({ created_by: userId });
        }
        if (teamOr.length) where = { AND: [baseWhere, { OR: teamOr }] };
        // apply allowed status filters (if provided) otherwise use allowCompleted fallback
        if (Array.isArray(allowedStatusFilters) && allowedStatusFilters.length) {
            const statusOr = allowedStatusFilters.map((s) => ({ event_statuses: { status: { contains: s } } }));
            where = { AND: [where, { OR: statusOr }] };
        } else if (!allowCompleted) {
            where = { AND: [where, { NOT: { event_statuses: { status: { contains: 'complete' } } } }] };
        }
    } else if (scope === 'personal') {
        const personalOr = [];
        if (userId) {
            personalOr.push({ user_id: userId });
            personalOr.push({ dj_id: userId });
            personalOr.push({ created_by: userId });
        }
        if (personalOr.length) where = { AND: [baseWhere, { OR: personalOr }] };
    }

    if (search) {
        const searchValue = String(search).trim();
        const or = [
            { venues: { is: { venue: { contains: searchValue } } } },
            { users_events_dj_idTousers: { is: { name: { contains: searchValue } } } },
        ];

        const dateRange = parseSearchDate(searchValue);
        if (dateRange) {
            or.push({ date: { gte: dateRange.startOfDay, lte: dateRange.endOfDay } });
        }

        where.OR = or;
    }

    const events = await prisma.event.findMany({
        where,
        orderBy: { date: 'asc' },
        take: 100,
        select: {
            id: true,
            date: true,
            event_status_id: true,
            event_statuses: { select: { status: true } },
            couple_name: true,
            users_events_user_idTousers: { select: { id: true, name: true } },
            venues: { select: { venue: true } },
            users_events_dj_idTousers: { select: { name: true } },
        },
    });

    // normalize output so frontend can rely on fields
    const out = events.map((e) => ({
        id: e.id,
        date: e.date,
        event_status_id: e.event_status_id,
        event_status: e.event_statuses?.status || null,
        couple_name: e.couple_name || null,
        client: e.users_events_user_idTousers ? { id: e.users_events_user_idTousers.id, name: e.users_events_user_idTousers.name } : null,
        venue_name: e.venues?.venue || null,
        dj_name: e.users_events_dj_idTousers?.name || null,
    }));

    return out;

    return events.map((event) => ({
        id: event.id,
        date: event.date,
        venue_name: event.venues?.venue || null,
        dj_name: event.users_events_dj_idTousers?.name || null,
    }));
}

// `eventIds`, when given, scopes recalculation to just those events (and
// implies `force`, since a caller asking to recalculate a specific event
// just edited it and wants the fresh number immediately — not "only if it
// was already null"). Used to keep `profit` live after an interactive edit
// instead of waiting for the nightly cron, without paying for a full-table
// scan every time.
async function recalculateProfits({ force = false, eventIds: scopeEventIds = null } = {}) {
	// Laravel's AdminReportService only ever recomputes profit for
	// Confirmed/Completed/Cancelled events (event_status_id IN (2,3,4)) —
	// Open Enquiries (1) have no cost/profit concept yet.
	const statusFilter = { event_status_id: { in: [2, 3, 4] } };
	let where;
	if (Array.isArray(scopeEventIds) && scopeEventIds.length) {
		where = { AND: [statusFilter, { id: { in: scopeEventIds } }] };
	} else if (force) {
		where = statusFilter;
	} else {
		// `event_cost` was never being written anywhere, so every event's
		// `profit` was silently computed against a null cost (≈ full revenue).
		// A plain `{ profit: null }` filter would never pick those already-wrong
		// rows back up for correction, so also recompute whenever `event_cost`
		// is still null — that's exactly the set poisoned by the old bug.
		where = { AND: [statusFilter, { OR: [{ profit: null }, { event_cost: null }] }] };
	}

	const events = await prisma.event.findMany({
		where,
		select: {
			id: true,
			event_status_id: true,
			total_cost_for_equipment: true,
			extra_cost: true,
			dj_id: true,
			dj_package_name: true,
			dj_cost_price_for_event: true,
		},
	});

	if (events.length === 0) return { updated: 0 };

	const eventIds = events.map((e) => e.id);

	// Sum each event's equipment cost (basic + extras together — Laravel's
	// event_cost is their combined total, see AdminReportService::adminAllReport)
	// plus its DJ's cost, using the exact same status-dependent cost source as
	// reports.controller.js's pkg_agg/dj_pkg CTEs: once an event is
	// Completed/Cancelled (3/4) costs are frozen to the historical
	// event_package.cost_price / events.dj_cost_price_for_event snapshot;
	// while still Open/Confirmed (1/2) they track the live
	// equipment.cost_price / package_users.cost_price.
	const placeholders = eventIds.map(() => "?").join(",");
	const costRows = await prisma.$queryRawUnsafe(
		`
		SELECT
			e.id AS event_id,
			COALESCE(pkg.cost_total, 0) AS pkg_cost_total,
			(CASE WHEN e.event_status_id IN (3,4) THEN COALESCE(e.dj_cost_price_for_event, 0) ELSE COALESCE(dp.cost_price, 0) END) AS dj_cost
		FROM events e
		LEFT JOIN (
			SELECT
				ep.event_id,
				SUM(
					(CASE WHEN ev.event_status_id IN (3,4) THEN COALESCE(ep.cost_price, 0) ELSE COALESCE(eq.cost_price, 0) END)
					* COALESCE(ep.quantity, 0)
				) AS cost_total
			FROM event_package ep
			JOIN events ev ON ev.id = ep.event_id
			LEFT JOIN equipment eq ON eq.id = ep.equipment_id
			WHERE ep.event_id IN (${placeholders})
			GROUP BY ep.event_id
		) pkg ON pkg.event_id = e.id
		LEFT JOIN (
			SELECT user_id, package_name, MAX(COALESCE(cost_price, 0)) AS cost_price
			FROM package_users
			GROUP BY user_id, package_name
		) dp ON dp.user_id = e.dj_id AND dp.package_name = e.dj_package_name
		WHERE e.id IN (${placeholders})
		`,
		...eventIds,
		...eventIds,
	);

	const costById = new Map();
	for (const row of costRows || []) {
		costById.set(Number(row.event_id), {
			pkgCostTotal: parseNumberLike(row.pkg_cost_total),
			djCost: parseNumberLike(row.dj_cost),
		});
	}

	// Compute all event_cost/profit values in-memory first — no DB calls in the loop
	const updates = events.map((e) => {
		const costs = costById.get(e.id) || { pkgCostTotal: 0, djCost: 0 };
		const eventCost = costs.pkgCostTotal + costs.djCost;
		const profit = parseNumberLike(e.total_cost_for_equipment) - eventCost - parseNumberLike(e.extra_cost);
		return { id: e.id, eventCost, profit };
	});

	// Batch into chunks of 500 per transaction — reduces N roundtrips to ceil(N/500)
	const CHUNK_SIZE = 500;
	let updated = 0;
	for (let i = 0; i < updates.length; i += CHUNK_SIZE) {
		const chunk = updates.slice(i, i + CHUNK_SIZE);
		await prisma.$transaction(
			chunk.map((u) => prisma.event.update({ where: { id: u.id }, data: { event_cost: u.eventCost, profit: u.profit } }))
		);
		updated += chunk.length;
	}

	return { updated };
}

export default { getDashboardStats, getUpcomingEvents, recalculateProfits };
