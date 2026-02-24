import prisma from "../utils/prismaClient.js";
import catchAsync from "../utils/catchAsync.js";
import { serializeForJson } from "../utils/serialize.js";
import { v4 as uuidv4 } from "uuid";

// Create enquiry (core fields + event packages + rig notes + initial note)
export const createEnquiry = catchAsync(async (req, res) => {
  const body = req.body || {};

  // Accept either `dj_id`, legacy `user_id`, or `dj_name` from clients; normalize to `dj_id`
  if (!body.dj_id && body.user_id) body.dj_id = body.user_id;
  if (!body.dj_id && body.dj_name) body.dj_id = body.dj_name;
  if (body.dj_id) body.dj_id = Number(body.dj_id);

  // Basic validation: require event date/time, DJ and venue (match Laravel behaviour)
  const required = ["event_date", "start_time", "end_time", "dj_id", "venue_id"];
  for (const f of required) if (!body[f]) return res.status(400).json({ error: `${f}_required` });

  // Client upsert: allow passing `client_id`, a `client` object, or client fields (email preferred)
  let client = null;
  if (body.client_id || (body.client && body.client.id)) {
    const id = body.client_id ? Number(body.client_id) : Number(body.client.id);
    client = await prisma.user.findUnique({ where: { id } });
    if (!client) return res.status(404).json({ error: 'client_not_found' });
  } else if ((body.client && body.client.email) || body.email || body.name) {
    const email = body.client?.email ?? body.email ?? null;
    const name = body.client?.name ?? body.name ?? 'Client';
    const contact_number = body.client?.contact_number ?? body.contact_number ?? null;
    const address = body.client?.address ?? body.address ?? null;

    if (email) {
      const emailNorm = String(email).toLowerCase();
      client = await prisma.user.findUnique({ where: { email: emailNorm } });
      if (client) {
        client = await prisma.user.update({ where: { id: client.id }, data: {
          name: name || client.name,
          contact_number: contact_number || client.contact_number,
          address: address || client.address,
        }});
      } else {
        client = await prisma.user.create({ data: {
          name: name || 'Client',
          email: emailNorm,
          contact_number: contact_number || null,
          address: address || null,
          role_id: 4,
        }});
      }
    } else {
      // No email provided: create minimal client record
      client = await prisma.user.create({ data: {
        name: name || 'Client',
        contact_number: contact_number || null,
        address: address || null,
        role_id: 4,
      }});
    }
  } else {
    return res.status(400).json({ error: 'client_required' });
  }

  // Parse date/time: assume `event_date` is d-m-Y and times are H:i (frontend)
  // Build UTC datetime strings
  const { event_date, start_time, end_time } = body;

  // Convert frontend `DD-MM-YYYY` + `HH:mm` into a UTC Date object
  const toUtcString = (dateStr, timeStr) => {
    if (!dateStr || !timeStr) return null;
    const [d, m, y] = dateStr.split('-').map(Number);
    const [hh, mm] = timeStr.split(':').map(Number);
    return new Date(Date.UTC(y, (m || 1) - 1, d || 1, hh || 0, mm || 0, 0));
  };

  const start = toUtcString(event_date, start_time);
  const end = toUtcString(event_date, end_time);

  const contract_token = uuidv4();

  // Prepare event data
  const eventData = {
    contract_token,
    // connect client via relation to avoid depending on scalar FK naming
    users_events_user_idTousers: { connect: { id: client.id } },
    // connect venue relation if provided
    ...(body.venue_id ? { venues: { connect: { id: Number(body.venue_id) } } } : {}),
    // dj relation
    ...(body.dj_id ? { users_events_dj_idTousers: { connect: { id: Number(body.dj_id) } } } : {}),
    dj_package_name: body.dj_package_name || null,
    // set status via relation
    event_statuses: { connect: { id: 1 } },
    date: (() => {
      if (!event_date) return null;
      const [d, m, y] = String(event_date).split('-').map(Number);
      return new Date(Date.UTC(y || 0, (m || 1) - 1, d || 0));
    })(),
    start_time: start || null,
    end_time: end || null,
    details: body.event_details || null,
    total_cost_for_equipment: body.totalCost != null ? Number(body.totalCost) : null,
    dj_cost_price_for_event: body.dj_cost_price != null ? Number(body.dj_cost_price) : null,
    is_vat_available_for_the_event: !!body.is_vat_available_for_the_event,
    created_by: req.user?.id || null,
    deposit_amount: body.deposit_amount != null ? Number(body.deposit_amount) : null,
  };

  // Transaction: create event, create event packages, add initial note
  const created = await prisma.$transaction(async (tx) => {
    const event = await tx.event.create({ data: eventData });

    const createdPackages = [];

    // Normalize bracketed form-data structures (equipmentData[0][...]) into arrays
    const normalizeArrayField = (field) => {
      if (Array.isArray(field)) return field;
      if (field && typeof field === 'object') return Object.keys(field).map(k => field[k]);
      return [];
    };

    const equipmentArray = normalizeArrayField(body.equipmentData);
    const extraArray = normalizeArrayField(body.extraData);
    const rigNotesArray = normalizeArrayField(body.rigNotesData);

    // helper to create packages array items
    const makePackage = (p) => ({
      equipment_id: p.equipment_id ? Number(p.equipment_id) : null,
      equipment_order_id: p.equipment_order_id !== undefined ? Number(p.equipment_order_id) : null,
      event_id: Number(event.id),
      package_type_id: p.package_type_id !== undefined ? Number(p.package_type_id) : null,
      sell_price: p.sell_price != null ? Number(p.sell_price) : null,
      cost_price: p.cost_price != null ? Number(p.cost_price) : null,
      notes: p.notes || null,
      rig_notes: p.rig_notes || null,
      payment_send: p.payment_send || null,
      payment_date: p.payment_date ? new Date(p.payment_date) : null,
      quantity: p.quantity != null ? Number(p.quantity) : null,
      total_price: p.total_price != null ? Number(p.total_price) : null,
      price_added_to_bill: p.price_added_to_bill != null ? Number(p.price_added_to_bill) : null,
      created_at: new Date(),
    });

    for (const p of equipmentArray) {
      const data = makePackage(p);
      const cp = await tx.eventPackage.create({ data });
      createdPackages.push(cp);
    }

    for (const p of extraArray) {
      const data = makePackage(p);
      const cp = await tx.eventPackage.create({ data });
      createdPackages.push(cp);
    }

    // Apply rig notes updates (if provided as rigNotesData: [{ equipment_id, rig_notes }])
    if (rigNotesArray.length) {
      for (const r of rigNotesArray) {
        await tx.eventPackage.updateMany({
          where: { event_id: Number(event.id), equipment_id: Number(r.equipment_id) },
          data: { rig_notes: r.rig_notes || null }
        });
      }
    }

    // Create initial event note
    // create initial event note (use `eventNote` client name)
    await tx.eventNote.create({ data: {
      event_id: Number(event.id),
      notes: 'Created as an enquiry',
      created_by: req.user?.id || null,
      created_at: new Date(),
    }}).catch(()=>{});

    return { event, event_packages: createdPackages, user: client };
  });

  res.status(201).json(serializeForJson(created));
});

export default { createEnquiry };
