import prisma from '../utils/prismaClient.js';
import catchAsync from '../utils/catchAsync.js';
import { serializeForJson } from '../utils/serialize.js';
import eventNoteService from '../services/eventNoteService.js';
import { getSignedGetUrl } from '../utils/s3Client.js';

// Confirm open enquiry: create payment + invoice + set event as confirmed
const confirmEvent = catchAsync(async (req, res) => {
  console.log()
  const body = req.validated || req.body || {};
  const eventId = Number(req.params.id);
  // accept `company_name` (id) per new request shape, fall back to names_id
  const namesId = Number(body.company_name || body.names_id || 0) || null;
  const depositAmount = Number(body.deposit_amount ?? body.amount ?? 0) || 0;
  const paymentData = {
    event_id: eventId,
    payment_method_id: Number(body.payment_method_id),
    date: body.date ? new Date(body.date) : new Date(),
    amount: depositAmount,
    created_at: new Date(),
  };

  const result = await prisma.$transaction(async (tx) => {
    // create payment
    const payment = await tx.eventPayment.create({ data: paymentData });

    // ensure unique invoice number
    let invoiceNumber;
    do {
      invoiceNumber = String(Math.floor(Math.random() * 99999) + 1).padStart(
        5,
        "0",
      );
      // check existing invoice (invoice stored as Int in DB)
      // parse to number for comparison
      // use findFirst to check existence
      var existing = await tx.event.findFirst({
        where: { invoice: Number(invoiceNumber) },
      });
    } while (existing);

    // update event: set invoice, status=2, names_id and deposit if provided
    const eventUpdateData = {
      invoice: Number(invoiceNumber),
      event_status_id: 2,
    };
    if (namesId) eventUpdateData.names_id = namesId;
    if (depositAmount) eventUpdateData.deposit_amount = depositAmount;
    // if an event_date was provided, convert to DB date and set
    try {
      if (body.event_date) {
        const dt = toDbDate(body.event_date);
        if (dt) eventUpdateData.date = new Date(dt);
      }
    } catch (e) {}

    await tx.event.update({ where: { id: eventId }, data: eventUpdateData });

    // load event packages similar to Laravel
    const eventPackages = await tx.eventPackage.findMany({
      where: { event_id: eventId, package_type_id: { in: [1, 2] } },
      select: {
        id: true,
        event_id: true,
        equipment_id: true,
        package_type_id: true,
        sell_price: true,
        total_price: true,
        price_added_to_bill: true,
        quantity: true,
        notes: true,
        equipment: {
          select: {
            id: true,
            name: true,
            sell_price: true,
            equipment_properties: { include: { properties: true } },
          },
        },
      },
    });

    // VAT calculation based on CompanyName (namesId)
    const company = await tx.companyName
      .findUnique({ where: { id: BigInt(namesId) } })
      .catch(() => null);
    // note: company model id is BigInt in prisma; guard absence
    if (company && company.vat != null) {
      const vatPercentage = company.vat_percentage
        ? Number(company.vat_percentage) / 100.0
        : 0;
      const totalCost = await tx.event.findUnique({
        where: { id: eventId },
        select: { total_cost_for_equipment: true },
      });
      const totalCostNum =
        totalCost && totalCost.total_cost_for_equipment
          ? Number(totalCost.total_cost_for_equipment)
          : 0;
      const totalWithVat = totalCostNum * (1 + vatPercentage);
      const vatValue = totalCostNum * vatPercentage;
      await tx.event.update({
        where: { id: eventId },
        data: {
          total_cost_for_equipment: String(totalWithVat),
          event_amount_without_vat: String(totalCostNum),
          vat_value: String(vatValue),
          is_vat_available_for_the_event: true,
        },
      });
    } else {
      await tx.event.update({
        where: { id: eventId },
        data: { is_vat_available_for_the_event: false },
      });
    }

    // activity log placeholder: skipped (not present in Node)

    // create note 'Confirmed as an event'
    await eventNoteService.createNote(tx, {
      eventId,
      notes: "Confirmed as an event",
      created_by: req.user?.id || null,
    });

    // recalc payments and mark fully paid
    const totalPaymentRow = await tx.eventPayment.aggregate({
      where: { event_id: eventId },
      _sum: { amount: true },
    });
    const totalPayment = totalPaymentRow._sum.amount || 0;
    const totalCostRow = await tx.event.findUnique({
      where: { id: eventId },
      select: { total_cost_for_equipment: true },
    });
    const totalCostNum =
      totalCostRow && totalCostRow.total_cost_for_equipment
        ? Number(totalCostRow.total_cost_for_equipment)
        : 0;
    const paymentSent = totalPayment === totalCostNum ? true : false;
    await tx.event.update({
      where: { id: eventId },
      data: { is_event_payment_fully_paid: paymentSent },
    });

    // fetch payment method name
    const paymentWithMethod = await tx.eventPayment.findUnique({
      where: { id: payment.id },
      include: { payment_methods: true },
    });

    // fetch latest event note
    const eventNotes = await tx.eventNote.findMany({
      where: { event_id: eventId },
      orderBy: { id: "desc" },
      take: 1,
    });

    return {
      id: payment.id,
      event_id: payment.event_id,
      payment_method: paymentWithMethod?.payment_methods?.name || null,
      date: payment.date,
      amount: payment.amount,
      invoice_number: invoiceNumber,
      event_packages: eventPackages,
      names_id: namesId,
      eventNotes: eventNotes.length ? eventNotes[0] : null,
    };
  });

  // Try to create a calendar event in Microsoft Graph (best-effort).
  try {
    // load event details
    const event = await prisma.event.findUnique({
      where: { id: Number(result.event_id) },
      include: { users_events_user_idTousers: true, venues: true },
    });
    if (event) {
      const startIso = event.start_time
        ? new Date(event.start_time).toISOString()
        : event.date
          ? new Date(event.date).toISOString()
          : null;
      const endIso = event.end_time
        ? new Date(event.end_time).toISOString()
        : event.date
          ? new Date(event.date).toISOString()
          : null;
      const subject = `USRMusic Event #${event.id} - ${event.users_events_user_idTousers?.name || "Client"}`;
      const content = event.details || "";
      const location = event.venues?.venue || "";

      const created = await microsoftGraph
        .createEvent({ subject, content, startIso, endIso, location })
        .catch(() => null);
      if (created && created.id) {
        // add an event note recording the external calendar id so we can find it later
        await eventNoteService
          .createNote(prisma, {
            eventId: event.id,
            notes: `CalendarEventId: ${created.id}`,
            created_by: req.user?.id || null,
          })
          .catch(() => {});
      }
    }
  } catch (e) {
    console.error(
      "[enquiryController] microsoft graph create failed",
      e?.message || e,
    );
  }
  console.log("hello");
  // Send invoice/confirmation emails to client and admins (parity with Laravel)
  try {
    const event = await prisma.event.findUnique({
      where: { id: Number(result.event_id) },
      include: { users_events_user_idTousers: true, venues: true },
    });
    const user = event?.users_events_user_idTousers || null;

    // Load email template for confirmed invoice (fallback to generic)
    const template = await prisma.emailContent
      .findFirst({ where: { email_name: "SEND INVOICE-CONFIRMED" } })
      .catch(() => null);

    const subject = template?.subject || `Invoice for event #${event?.id}`;
    const bodyText = template?.body || `Your event has been confirmed.`;

    // company details
    let companyDetails = null;
    if (result.names_id) {
      companyDetails =
        (await prisma.companyName.findUnique({
          where: { id: BigInt(result.names_id) },
        }).catch(() => null)) || null;
    }

    // const makeCompanyHtml = (c) => {
    //   if (!c) return "";
    //   const logo = c.company_logo
    //     ? `<img src="${process.env.APP_URL || ""}public/storage/images/${c.company_logo}" style="max-width:100px;" alt="Logo" />`
    //     : "";
    //   const addr = [c.address_name, c.street, c.city, c.postal_code]
    //     .filter(Boolean)
    //     .join("<br />");
    //   const contact = [];
    //   if (c.telephone_number) contact.push(`<strong>Telephone</strong> ${c.telephone_number}`);
    //   if (c.email) contact.push(`<strong>Email</strong> <a href="mailto:${c.email}">${c.email}</a>`);
    //   if (c.website) contact.push(`<strong>Website</strong> ${c.website}`);
    //   return `<div>${logo}<div>${addr}</div><div>${contact.join("<br />")}</div></div>`;
    // };

    // render Blade-like HTML for client using renderer
    const firstName = user?.name || "Client";
    const clientHtml = renderConfirmedEvent({ first_name: firstName, body: bodyText, companyDetails: companyDetails || {} });
    if (user && user.email) {
      await sendEmail({ to: [user.email], subject, html: clientHtml }).catch(() => {});
    }

    // notify admins (role_id = 2) who have email enabled
    const admins = await prisma.user.findMany({
      where: { role_id: BigInt(2), is_email_send: true },
    });
    const adminEmails = admins.map((a) => a.email).filter(Boolean);
    if (adminEmails.length) {
      const adminHtml = `
        <p>Event #${event?.id} has been confirmed.</p>
        <p>Invoice: ${result.invoice_number || "N/A"}</p>
        <p>Amount Paid: ${result.amount || 0}</p>
      `;
      await sendEmail({
        to: adminEmails,
        subject: `Event Confirmed - #${event?.id}`,
        html: adminHtml,
      }).catch(() => {});
    }
  } catch (e) {
    console.error("[enquiryController] send confirm emails failed", e?.message || e);
  }

  res.json(serializeForJson({ success: true, data: result }));
});
const sendEventConfirmationEmail = catchAsync(async (req, res) => {
  // payload may be nested under `body` when validated by Joi
  const payload = (req.validated && req.validated.body)
    ? req.validated.body
    : (req.body && req.body.body)
    ? req.body.body
    : req.body || {};

  const event_id = Number(payload.event_id || req.params.id || payload.id);
  const bodyText = String(payload.body || "");
  const subject = String(payload.subject || `Event #${event_id} Confirmation`);
  const companyId = payload.company_name_id ? Number(payload.company_name_id) : null;

  if (!event_id) return res.status(400).json({ error: "event_id_required" });

  const event = await prisma.event.findUnique({
    where: { id: event_id },
    include: { users_events_user_idTousers: true, venues: true },
  });

  if (!event) return res.status(404).json({ error: "event_not_found" });

  const user = event.users_events_user_idTousers || null;
  const to = user?.email || payload.email || null;

  let companyDetails = null;
  if (companyId) {
    companyDetails = await prisma.companyName.findUnique({ where: { id: BigInt(companyId) } }).catch(() => null);
  }

  const firstName = user?.name || "Client";
  const clientHtml = renderConfirmedEvent({ first_name: firstName, body: bodyText, companyDetails: companyDetails || {} });

  try {
    if (to) await sendEmail({ to: [to], subject, html: clientHtml }).catch(() => {});
  } catch (e) {
    console.error('[sendEventConfirmationEmail] sendEmail failed', e?.message || e);
  }

  // create store note
  await eventNoteService.createNote(prisma, {
    eventId: event_id,
    notes: `Email Sent - ${companyDetails?.name || ''}`,
    created_by: req.user?.id || null,
  }).catch(() => {});

  const latestNote = await prisma.eventNote.findFirst({ where: { event_id }, orderBy: { id: 'desc' } }).catch(() => null);

  const userData = user ? { name: user.name, email: user.email } : null;

  res.json(serializeForJson({ success: true, data: userData, eventNotes: latestNote || null }));
});

const listConfirmEvents = catchAsync(async (req, res) => {
  const q = req.query || {};
  const search = String(q.search || '').trim();

  const where = { event_status_id: 1 };
  if (search) {
    where.OR = [
      { usr_name: { contains: search } },
      { venues: { is: { venue: { contains: search } } } },
      { users_events_user_idTousers: { is: { name: { contains: search } } } },
    ];
  }

  const events = await prisma.event.findMany({
    where,
    select: {
      id: true,
      date: true,
      users_events_user_idTousers: { select: { name: true } },
      venues: { select: { venue: true } },
    },
    orderBy: { date: 'asc' },
  });

  res.json(serializeForJson({ success: true, data: events }));
});

const getConfirmEvent = catchAsync(async (req, res) => {
  const event_id = Number(req.params.id);
 
  // load event with related data including any event-specific uploads
  // include contracts and their signatures so we can presign any stored keys
  const event = await prisma.event.findUnique({
    where: { id: event_id },
    include: {
      users_events_user_idTousers: true,
      venues: true,
      event_package: true,
      event_payments: true,
      // load related file uploads attached to this event
      file_uploads: { include: { users: true, events: true } },
      contracts: { include: { signatures: true } },
    },
  }).catch(() => null);

  if (!event) return res.status(404).json({ error: "event_not_found" });

  // fetch global files (where event_id is null and general = true)
  const globalFiles = await prisma.fileUpload.findMany({
    where: { event_id: null, general: true },
    include: { users: true, events: true },
  }).catch(() => []);

  // merge event-specific uploads with global files (preserve array shape)
  const eventFiles = Array.isArray(event.file_uploads) ? event.file_uploads : [];
  const mergedFiles = eventFiles.concat(globalFiles || []);
  // attach merged files to the response under the same key used elsewhere
  event.file_uploads = mergedFiles;

  // presign contract PDFs and signature images (best-effort)
  if (Array.isArray(event.contracts)) {
    for (const contract of event.contracts) {
      if (contract && contract.signed_pdf_path) {
        try {
          contract.signed_pdf_url = await getSignedGetUrl(contract.signed_pdf_path);
        } catch (e) {
          contract.signed_pdf_url = null;
        }
      }
      if (Array.isArray(contract.signatures)) {
        for (const sig of contract.signatures) {
          if (sig && sig.signature_path) {
            try {
              sig.signature_url = await getSignedGetUrl(sig.signature_path);
            } catch (e) {
              sig.signature_url = null;
            }
          }
        }
      }
    }
  }

  // attach company name details (including admin signature presign)
  if (event.names_id) {
    try {
      const company = await prisma.companyName.findUnique({ where: { id: BigInt(event.names_id) } }).catch(() => null);
      if (company) {
        if (company.admin_signature) {
          try {
            company.admin_signature_url = await getSignedGetUrl(company.admin_signature);
          } catch (e) {
            company.admin_signature_url = null;
          }
        }

        // presign any contract PDF stored directly on the event row (contract_pdf_url)
        try {
          if (event.contract_pdf_url) {
            let key = null;
            try {
              const u = new URL(String(event.contract_pdf_url));
              key = u.pathname.replace(/^\//, "");
            } catch (e) {
              // not a full URL, assume it's already a stored key
              key = String(event.contract_pdf_url);
            }
            if (key) {
              try {
                event.contract_pdf_url = await getSignedGetUrl(key);
              } catch (e) {
                // leave original value if presign fails
              }
            }
          }
        } catch (e) {}
        // match Laravel shape: attach as `company_names`
        event.company_names = company;
      }
    } catch (e) {}
  }

  res.json(serializeForJson({ success: true, data: event }));
});

const sendInvoice = catchAsync(async (req, res) => {

});

export default {
  confirmEvent,
  listConfirmEvents,
  getConfirmEvent,
  sendEventConfirmationEmail,
  sendInvoice
};
