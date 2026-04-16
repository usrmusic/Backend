import prisma from '../utils/prismaClient.js';

const MONTH_LABELS = [
	'Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'
];

function parseNumberLike(v) {
	if (v == null) return 0;
	if (typeof v === 'number') return v;
	const s = String(v).replace(/[^0-9.\-]/g, '');
	const n = parseFloat(s);
	return Number.isFinite(n) ? n : 0;
}

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

async function getDashboardStats({ year = null } = {}) {
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
    const events = await prisma.event.findMany({
        where: { date: dateFilter },
        select: {
            id: true,
            date: true,
            profit: true,
            event_status_id: true,
            dj_id: true,
            couple_name: true,
            is_event_payment_fully_paid: true,
            event_amount_without_vat: true, // Used for Turnover
            vat_value: true,
            event_cost: true,
            users_events_dj_idTousers: { select: { id: true, name: true } },
            event_statuses: { select: { id: true, status: true } },
        },
    });

    // --- In-Memory Aggregations (Turnover, Profit, Monthly) ---
    const totalEvents = events.length;
    let totalProfit = 0;
    let totalTurnover = 0;

    const monthlyCounts = new Array(12).fill(0);
    const monthlyProfits = new Array(12).fill(0);
    const monthlyTurnover = new Array(12).fill(0);

    const statusCounts = {};
    const djCounts = {};

    events.forEach((e) => {
        const netAmount = parseNumberLike(e.event_amount_without_vat);
        const profitAmount = parseNumberLike(e.profit);
        
        // Update Totals
        totalTurnover += netAmount;
        totalProfit += profitAmount;

        // Update Monthly Breakdown
        if (e.date) {
            const m = new Date(e.date).getMonth();
            monthlyCounts[m] += 1;
            monthlyProfits[m] += profitAmount;
            monthlyTurnover[m] += netAmount;
        }

        // Sales Analytics (Status)
        const stName = e.event_statuses?.status ? String(e.event_statuses.status) : String(e.event_status_id || 'unknown');
        statusCounts[stName] = (statusCounts[stName] || 0) + 1;

        // Sales Analytics (DJ)
        const djName = e.users_events_dj_idTousers?.name ? String(e.users_events_dj_idTousers.name) : (e.dj_id ? String(e.dj_id) : 'unassigned');
        djCounts[djName] = (djCounts[djName] || 0) + 1;
    });
    const openEnquiriesCount = events.filter(e => e.event_statuses?.status?.toLowerCase().includes('open')).length;
    const confirmedEventsCount = events.filter(e => e.event_statuses?.status?.toLowerCase().includes('confirm')).length;

    /**
     * 2. Secondary Queries: Executed in parallel via Promise.all
     */
    const [pendingPaymentsRaw, openEnquiries, calendarEvents, recentNotes] = await Promise.all([
        // Pending Payments: Filtered by year + includes status ID
        prisma.event.findMany({
            where: { is_event_payment_fully_paid: false, date: dateFilter },
            select: {
                id: true,
                couple_name: true,
                deposit_amount: true,
                payment_date: true,
                event_status_id: true,
                event_payments: { select: { amount: true } },
                users_events_user_idTousers: { select: { id: true, name: true, email: true } },
            },
            orderBy: { date: 'asc' },
            take: 50,
        }),
        // Open Enquiries List
        prisma.event.findMany({
            where: { event_statuses: { status: { contains: 'open' } }, date: dateFilter },
            select: {
                id: true,
                couple_name: true,
                date: true,
                users_events_dj_idTousers: { select: { id: true, name: true } },
                users_events_user_idTousers: { select: { id: true, name: true } },
            },
            orderBy: { date: 'desc' },
            take: 50,
        }),
        // Confirmed Calendar Events
        prisma.event.findMany({
            where: { event_statuses: { status: { contains: 'confirm' } }, date: dateFilter },
            select: { id: true, date: true },
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

    // Map pending payments to include outstanding balance
    const pendingPayments = pendingPaymentsRaw.map((p) => {
        const paid = (p.event_payments || []).reduce((s, it) => s + parseNumberLike(it.amount), 0);
        const expected = parseNumberLike(p.deposit_amount) || 0;
        return {
            id: p.id,
            couple_name: p.couple_name,
            client_name: p.users_events_user_idTousers?.name || null,
            expected,
            paid,
            outstanding: Math.max(0, expected - paid),
            payment_date: p.payment_date,
            event_status_id: p.event_status_id
        };
    });

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

async function recalculateProfits({ force = false } = {}) {
	// Fetch events (optionally only those missing profit)
	const where = force ? {} : { profit: null };
	const events = await prisma.event.findMany({ where, select: { id: true, event_amount_without_vat: true, event_cost: true } });

	let updated = 0;
	for (const e of events) {
		const revenue = parseNumberLike(e.event_amount_without_vat);
		const cost = parseNumberLike(e.event_cost);
		const profit = revenue - cost;
		await prisma.event.update({ where: { id: e.id }, data: { profit } });
		updated += 1;
	}

	return { updated };
}

export default { getDashboardStats, recalculateProfits };
