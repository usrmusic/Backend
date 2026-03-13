import prisma from '../utils/prismaClient.js';
import catchAsync from '../utils/catchAsync.js';
import { serializeForJson } from '../utils/serialize.js';
import { parseFilterSort } from '../utils/queryHelpers.js';
import services from '../services/index.js';

const eventSvc = services.get('event');

const suppliersReport = catchAsync(async (req, res) => {
	const q = req.query || {};
	const { where: baseWhere = {}, orderBy, take, skip } = parseFilterSort(q);
	const page = Number(q.page || q.p || 1) || 1;
	const perPage = Number(q.perPage || q.per_page || q.limit || take || 1000) || (take || 1000);
	const supplierId = Number(q.supplier_id);

	// Merge supplier filter into event where clause
	const where = { ...baseWhere };
	if (supplierId) {
		where.event_package = { some: { equipment: { supplier_id: supplierId } } };
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
				{ users_events_user_idTousers: { is: { OR: [{ name: { contains: s } }, { email: { contains: s } }, { contact_number: { contains: s } }] } } },
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

	// time filters (treat times as 1970-01-01T<time>)
	if (q.event_start_time || q.event_end_time) {
		where.start_time = where.start_time || {};
		if (q.event_start_time) where.start_time.gte = new Date(`1970-01-01T${q.event_start_time}`);
		if (q.event_end_time) where.start_time.lte = new Date(`1970-01-01T${q.event_end_time}`);
	}

	// venue name
	if (q.venue_name) {
		where.venues = { is: { venue: { contains: String(q.venue_name) } } };
	}

	// cost (match event.total_cost_for_equipment)
	if (q.cost !== undefined && q.cost !== null && q.cost !== '') {
		where.total_cost_for_equipment = String(q.cost);
	}

	// package-related filters: quantity, payment_send, supplier_name
	if (q.quantity || q.payment_send !== undefined || q.supplier_name) {
		const pkgSome = (where.event_package && where.event_package.some) ? { ...where.event_package.some } : {};
		if (q.quantity) pkgSome.quantity = Number(q.quantity);
		if (q.payment_send !== undefined) {
			// filter packages that have a non-null payment_send when true, or null when false
			if (String(q.payment_send) === 'true' || q.payment_send === true) pkgSome.payment_send = { not: null };
			else pkgSome.payment_send = null;
		}
		if (q.supplier_name) {
			pkgSome.equipment = pkgSome.equipment || {};
			pkgSome.equipment.suppliers = { is: { name: { contains: String(q.supplier_name) } } };
		}
		where.event_package = { some: pkgSome };
	}

	// payment_date filter (events that have payments on that date)
	if (q.payment_date) {
		where.event_payments = { some: { date: { equals: new Date(q.payment_date) } } };
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
			dj_package_name: true,
			user_id: true,
			names_id: true,
			event_status_id: true,
			payment_send: true,
			payment_date: true,
		},
		sort: typeof orderBy === 'object' ? Object.keys(orderBy)[0] + ':' + Object.values(orderBy)[0] : undefined,
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
							equipment_properties: { select: { id: true, value: true, properties: { select: { id: true, name: true } } } },
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
			? await prisma.event.findMany({ where: { id: { in: eventIds } }, select: { id: true, total_cost_for_equipment: true } })
			: [];

		const costByEvent = new Map(costRows.map((r) => [Number(r.id), Number(r.total_cost_for_equipment || 0)]));


	// fetch company names for events that reference names_id
	const companyIds = Array.from(new Set(events.map((e) => e.names_id).filter(Boolean))).map((id) => BigInt(id));
	const companies = companyIds.length
		? await prisma.companyName.findMany({ where: { id: { in: companyIds } }, select: { id: true, name: true } })
		: [];

	const companyById = new Map(companies.map((c) => [String(c.id), c]));

	// assemble final payload
	const data = events.map((ev) => {
		const evPackages = packages.filter((p) => Number(p.event_id) === Number(ev.id));
		const mappedPackages = evPackages.map((p) => ({
			event_package_id: p.id,
			event_package_name: p.package_types?.type || null,
			cost_price: p.cost_price || null,
			payment_send: p.payment_send || null,
			payment_date: p.payment_date || null,
			sort_order: p.equipment_order_id || null,
			equipment_name: p.equipment?.name || null,
			equipment_properties: (p.equipment?.equipment_properties || []).map((ep) => ({ name: ep.properties?.name || null, value: ep.value || null })),
			quantity: p.quantity || null,
		}));

		const company = ev.names_id ? companyById.get(String(BigInt(ev.names_id))) : null;

		// payments for this event
		const evPayments = payments.filter((p) => Number(p.event_id) === Number(ev.id));
		const totalPaidForEvent = evPayments.reduce((s, r) => s + Number(r.amount || 0), 0);
		const latestPaymentDate = evPayments.length ? evPayments.reduce((a, b) => (a.date > b.date ? a : b)).date : null;

		return {
			event_id: ev.id,
			name: ev.usr_name || null,
			date: ev.date || null,
			start_time: ev.start_time || null,
			end_time: ev.end_time || null,
			venue: ev.venues?.venue || null,
			dj_package_name: ev.dj_package_name || null,
			user_id: ev.user_id || null,
			event_status_id: ev.event_status_id || null,
			payment_send: ev.payment_send || null,
			payment_date: ev.payment_date || null,
			payment: totalPaidForEvent,
			latest_payment_date: latestPaymentDate || null,
			company_name: company ? company.name : null,
			event_packages: mappedPackages,
		};
	});

	// statistics
	const today = new Date();
	const totalEvents = await eventSvc.model.count({ where });
	const remainingEvents = await eventSvc.model.count({ where: { ...where, date: { gte: today } } });

	// total cost (sum event.total_cost_for_equipment, fallback to package totals)
	let totalCost = 0;
	for (const id of eventIds) {
		const c = Number(costByEvent.get(Number(id)) || 0);
		if (c > 0) {
			totalCost += c;
			continue;
		}
		// fallback: sum package cost_price * quantity
		const pkgs = packages.filter((p) => Number(p.event_id) === Number(id));
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
			stats: { count: totalEvents, remainingEvents, totalCost, totalPaid, remaining },
		}),
	);
});

const adminReport = catchAsync(async (req, res) => {
	const q = req.query || {};
	const { where: baseWhere = {}, orderBy, take, skip } = parseFilterSort(q);
	const page = Number(q.page || q.p || 1) || 1;
	const perPage = Number(q.perPage || q.per_page || q.limit || take || 1000) || (take || 1000);

	// build where
	const where = { ...baseWhere };
	if (q.startDate || q.endDate) {
		where.date = where.date || {};
		if (q.startDate) where.date.gte = new Date(q.startDate);
		if (q.endDate) where.date.lte = new Date(q.endDate);
	}
	if (q.event_date) where.date = new Date(q.event_date);
	if (q.event_status) where.event_status_id = Number(q.event_status);
	if (q.search) {
		const s = String(q.search).trim();
		if (s) {
			where.OR = where.OR || [];
			where.OR.push(
				{ usr_name: { contains: s } },
				{ venues: { is: { venue: { contains: s } } } },
				{ users_events_user_idTousers: { is: { OR: [{ name: { contains: s } }, { email: { contains: s } }, { contact_number: { contains: s } }] } } },
			);
		}
	}
	if (q.venue_name) where.venues = { is: { venue: { contains: String(q.venue_name) } } };

	// company_name filter: resolve matching company ids then filter names_id
	if (q.company_name) {
		const companies = await prisma.companyName.findMany({ where: { name: { contains: String(q.company_name) } }, select: { id: true } });
		const ids = companies.map((c) => c.id);
		if (ids.length) where.names_id = { in: ids };
	}

	// dj_name filter
	if (q.dj_name) where.users_events_dj_idTousers = { is: { name: { contains: String(q.dj_name) } } };

	// numeric/range filters direct mapping
	if (q.total_price !== undefined) where.total_cost_for_equipment = Number(q.total_price);
	if (q.cost !== undefined) where.total_cost_for_equipment = Number(q.cost);
	if (q.extra_cost !== undefined) where.extra_cost = Number(q.extra_cost);
	if (q.profit !== undefined) where.profit = Number(q.profit);

	// pagination + fetch events
	const events = await eventSvc.list({
		filter: where,
		select: {
			id: true,
			event_cost: true,
			user_id: true,
			refund_amount: true,
			event_status_id: true,
			date: true,
			extra_cost: true,
			profit: true,
			venue_id: true,
			venues: { select: { id: true, venue: true } },
			users_events_user_idTousers: { select: { id: true, name: true } },
			users_events_dj_idTousers: { select: { id: true, name: true } },
			dj_id: true,
			dj_package_name: true,
			dj_cost_price_for_event: true,
			total_cost_for_equipment: true,
		},
		sort: typeof orderBy === 'object' ? Object.keys(orderBy)[0] + ':' + Object.values(orderBy)[0] : undefined,
		page,
		perPage,
	});

	const eventIds = events.map((e) => e.id);

	// fetch event packages for aggregation
	const eventPackages = eventIds.length
		? await prisma.eventPackage.findMany({ where: { event_id: { in: eventIds } }, select: { event_id: true, package_type_id: true, sell_price: true, cost_price: true, quantity: true } })
		: [];

	// fetch payments grouped per event
	const payments = eventIds.length
		? await prisma.eventPayment.findMany({ where: { event_id: { in: eventIds } }, select: { event_id: true, amount: true } })
		: [];

	// fetch package_users for DJs (to determine dj package cost_price)
	const djIds = Array.from(new Set(events.map((e) => Number(e.dj_id)).filter(Boolean)));
	const packageUsers = djIds.length
		? await prisma.package_users.findMany({ where: { user_id: { in: djIds } }, select: { user_id: true, package_name: true, cost_price: true, sell_price: true } })
		: [];

	// aggregate per-event values
	const pkgByEvent = new Map();
	for (const p of eventPackages) {
		const id = Number(p.event_id);
		if (!pkgByEvent.has(id)) pkgByEvent.set(id, []);
		pkgByEvent.get(id).push(p);
	}

	const paymentsByEvent = new Map();
	for (const p of payments) {
		const id = Number(p.event_id);
		paymentsByEvent.set(id, (paymentsByEvent.get(id) || 0) + Number(p.amount || 0));
	}

	const pkgUserMap = new Map();
	for (const pu of packageUsers) {
		pkgUserMap.set(`${pu.user_id}::${pu.package_name}`, pu);
	}

	const data = events.map((ev) => {
		const pkgs = pkgByEvent.get(Number(ev.id)) || [];
		const event_packages_sum_sell_price = pkgs.filter((x) => Number(x.package_type_id) === 2).reduce((s, r) => s + Number(r.sell_price || 0), 0);
		const extra_cost_price_total = pkgs.filter((x) => Number(x.package_type_id) === 2).reduce((s, r) => s + (Number(r.cost_price || 0) * Number(r.quantity || 0)), 0);
		const basic_cost_price_total = pkgs.filter((x) => Number(x.package_type_id) === 1).reduce((s, r) => s + (Number(r.cost_price || 0) * Number(r.quantity || 0)), 0);

		// dj cost price logic
		let dj_cost_price = 0;
		if (ev.event_status_id === 3 || ev.event_status_id === 4) {
			dj_cost_price = Number(ev.dj_cost_price_for_event || 0);
		} else {
			const key = `${ev.dj_id}::${ev.dj_package_name}`;
			const pu = pkgUserMap.get(key);
			if (pu) dj_cost_price = Number(pu.cost_price || 0);
		}

		const cost = basic_cost_price_total + extra_cost_price_total + dj_cost_price;
		const payment_sum = paymentsByEvent.get(Number(ev.id)) || 0;

		return {
			id: ev.id,
			event_cost: ev.event_cost || cost,
			user_id: ev.user_id || null,
			refund_amount: ev.refund_amount || 0,
			event_status_id: ev.event_status_id || null,
			date: ev.date || null,
			extra_cost: ev.extra_cost || null,
			profit: ev.profit || null,
			venue_id: ev.venue_id || null,
			venue: ev.venues?.venue || null,
			dj_first_name: ev.users_events_dj_idTousers?.name || null,
			name: ev.users_events_user_idTousers?.name || null,
			company_name: ev.names_id || null,
			sell_price: event_packages_sum_sell_price,
			dj_cost_price,
			total_cost_for_equipment: ev.total_cost_for_equipment || null,
			deposit_amount: payment_sum,
			event_packages_sum_sell_price,
			extra_cost_price_total,
			basic_cost_price_total,
			cost,
		};
	});

	// stats
	const totalEvents = await eventSvc.model.count({ where });
	const today = new Date();
	const remainingEvents = await eventSvc.model.count({ where: { ...where, date: { gte: today } } });
	const totalCost = data.reduce((s, r) => s + Number(r.cost || 0), 0);
	const totalPaid = data.reduce((s, r) => s + Number(r.deposit_amount || 0), 0);
	const remaining = totalCost - totalPaid;

	res.json(
		serializeForJson({
			success: true,
			result: data,
			page,
			perPage,
			total: totalEvents,
			stats: { count: totalEvents, remainingEvents, totalCost, totalPaid, remaining },
		}),
	);
});

export default { suppliersReport, adminReport };
