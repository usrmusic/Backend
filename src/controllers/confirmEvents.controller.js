import prisma from "../utils/prismaClient.js";
import catchAsync from "../utils/catchAsync.js";
import { serializeForJson } from "../utils/serialize.js";
import eventNoteService from "../services/eventNoteService.js";
import { getSignedGetUrl, uploadStreamToS3 } from "../utils/s3Client.js";
import generatePdfBufferFromHtml from "../utils/pdfGenerator.js";
import renderSendQuote from "../templates/sendQuoteTemplate.js";
import renderInvoice from "../templates/invoiceTemplate.js";
import sendEmail from "../utils/mail/resendClient.js";
import microsoftGraph from "../utils/microsoftGraph.js";

// Confirm open enquiry: create payment + invoice + set event as confirmed
const confirmEvent = catchAsync(async (req, res) => {
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
        (await prisma.companyName
          .findUnique({
            where: { id: BigInt(result.names_id) },
          })
          .catch(() => null)) || null;
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
    const clientHtml = renderConfirmedEvent({
      first_name: firstName,
      body: bodyText,
      companyDetails: companyDetails || {},
    });
    if (user && user.email) {
      await sendEmail({ to: [user.email], subject, html: clientHtml }).catch(
        () => {},
      );
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
    console.error(
      "[enquiryController] send confirm emails failed",
      e?.message || e,
    );
  }

  res.json(serializeForJson({ success: true, data: result }));
});
const sendEventConfirmationEmail = catchAsync(async (req, res) => {
  // payload may be nested under `body` when validated by Joi
  const payload =
    req.validated && req.validated.body
      ? req.validated.body
      : req.body && req.body.body
        ? req.body.body
        : req.body || {};

  const event_id = Number(payload.event_id || req.params.id || payload.id);
  const bodyText = String(payload.body || "");
  const subject = String(payload.subject || `Event #${event_id} Confirmation`);
  const companyId = payload.company_name_id
    ? Number(payload.company_name_id)
    : null;

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
    companyDetails = await prisma.companyName
      .findUnique({ where: { id: BigInt(companyId) } })
      .catch(() => null);
  }

  const firstName = user?.name || "Client";
  const clientHtml = renderConfirmedEvent({
    first_name: firstName,
    body: bodyText,
    companyDetails: companyDetails || {},
  });

  try {
    if (to)
      await sendEmail({ to: [to], subject, html: clientHtml }).catch(() => {});
  } catch (e) {
    console.error(
      "[sendEventConfirmationEmail] sendEmail failed",
      e?.message || e,
    );
  }

  // create store note
  await eventNoteService
    .createNote(prisma, {
      eventId: event_id,
      notes: `Email Sent - ${companyDetails?.name || ""}`,
      created_by: req.user?.id || null,
    })
    .catch(() => {});

  const latestNote = await prisma.eventNote
    .findFirst({ where: { event_id }, orderBy: { id: "desc" } })
    .catch(() => null);

  const userData = user ? { name: user.name, email: user.email } : null;

  res.json(
    serializeForJson({
      success: true,
      data: userData,
      eventNotes: latestNote || null,
    }),
  );
});

const listConfirmEvents = catchAsync(async (req, res) => {
  const q = req.query || {};
  const search = String(q.search || "").trim();
  const page = q.page ? Math.max(1, Number(q.page)) : 1;
  const limit = q.perPage
    ? Math.min(100, Number(q.perPage))
    : q.limit
    ? Math.min(100, Number(q.limit))
    : 10;

  const where = { event_status_id: 2 };
  if (search) {
    where.OR = [
      { usr_name: { contains: search } },
      { venues: { is: { venue: { contains: search } } } },
      { users_events_user_idTousers: { is: { name: { contains: search } } } },
    ];
  }

  const total = await prisma.event.count({ where });

  const events = await prisma.event.findMany({
    where,
    select: {
      id: true,
      date: true,
      users_events_user_idTousers: { select: { name: true } },
      venues: { select: { venue: true } },
    },
    orderBy: { date: "asc" },
  });
  const meta = { total, page, perPage: limit, totalPages: Math.ceil(total / limit) };

  res.json(serializeForJson({ success: true, data: events, meta }));
});

const listCompletedConfirmEvents = catchAsync(async (req, res) => {
  const q = req.query || {};
  const search = String(q.search || "").trim();
  const paymentStatus = String(q.paymentStatus || q.paymentstatus || "").trim().toLowerCase();
  const page = q.page ? Math.max(1, Number(q.page)) : 1;
  const limit = q.perPage
    ? Math.min(100, Number(q.perPage))
    : q.limit
    ? Math.min(100, Number(q.limit))
    : 10;

  const where = { event_status_id: 3 };
  if (paymentStatus) {
    if (paymentStatus === "completed") {
      where.is_event_payment_fully_paid = true;
    } else if (paymentStatus === "pending") {
      where.is_event_payment_fully_paid = false;
    }
  }
  if (search) {
    where.OR = [
      { usr_name: { contains: search } },
      { venues: { is: { venue: { contains: search } } } },
      { users_events_user_idTousers: { is: { name: { contains: search } } } },
    ];
  }

  const total = await prisma.event.count({ where });

  const events = await prisma.event.findMany({
    where,
    select: {
      id: true,
      date: true,
      users_events_user_idTousers: { select: { name: true, email: true, contact_number: true } },
      venues: { select: { venue: true } },
      event_payments: { select: { amount: true, date: true } },
      total_cost_for_equipment: true,
      is_event_payment_fully_paid: true,
      // event_cost: true,
    },
    orderBy: { date: "asc" },
    skip: (page - 1) * limit,
    take: limit,
  });

   // Enrich events with payment summary: total paid, last payment date, remaining amount
  const enriched = (events || []).map((e) => {
    const payments = Array.isArray(e.event_payments) ? e.event_payments : [];
    const totalPaid = payments.reduce((s, p) => s + (Number(p.amount || 0) || 0), 0);
    let lastDate = null;
    for (const p of payments) {
      if (!p || !p.date) continue;
      const d = new Date(p.date);
      if (!lastDate || d > lastDate) lastDate = d;
    }
    const totalCost = e.total_cost_for_equipment ? Number(e.total_cost_for_equipment) : 0;
    const remaining = Math.max(0, totalCost - totalPaid);
    return {
      ...e,
      payment_paid: totalPaid,
      payment_paid_date: lastDate ? lastDate.toISOString() : null,
      payment_remaining: remaining,
    };
  });

  const meta = { total, page, perPage: limit, totalPages: Math.ceil(total / limit) };
  res.json(serializeForJson({ success: true, data: enriched, meta }));

  // res.json(serializeForJson({ success: true, data: events }));
});

const getConfirmEvent = catchAsync(async (req, res) => {
  const event_id = Number(req.params.id);
  if (!event_id) return res.status(400).json({ error: "invalid_id" });

  // Batch independent reads in a single transaction to reduce DB round-trips
  const [event, globalFiles, notes, todos] = await prisma
    .$transaction([
      prisma.event.findUnique({
        where: { id: event_id },
        include: {
          users_events_user_idTousers: { select: { id: true, name: true, email: true, profile_photo: true, contact_number: true } },
          venues: true,
          event_package: true,
          event_payments: true,
          file_uploads: { include: { users: { select: { id: true, name: true, email: true, profile_photo: true, contact_number: true } }, events: true } },
          contracts: { include: { signatures: true } },
        },
      }),
      prisma.fileUpload.findMany({ where: { event_id: null, general: true }, include: { users: { select: { id: true, name: true, email: true, profile_photo: true, contact_number: true } }, events: true } }),
      prisma.eventNote.findMany({ where: { event_id }, orderBy: { id: 'asc' } }),
      prisma.todos.findMany({ where: { event_id }, orderBy: { id: 'asc' } }),
    ])
    .catch(() => [null, [], [], []]);

  if (!event) return res.status(404).json({ error: "event_not_found" });

  // merge global files with event uploads
  event.file_uploads = (Array.isArray(event.file_uploads) ? event.file_uploads : []).concat(globalFiles || []);

  // merged presign pipeline: contracts (pdf + signatures), company admin signature, contract_pdf_url (best-effort)
  try {
    const presignTasks = [];

    // contracts and their signatures
    if (Array.isArray(event.contracts)) {
      for (const contract of event.contracts) {
        if (contract?.signed_pdf_path) {
          presignTasks.push(
            getSignedGetUrl(String(contract.signed_pdf_path))
              .then((url) => {
                contract.signed_pdf_url = url;
              })
              .catch(() => {
                contract.signed_pdf_url = null;
              }),
          );
        }
        if (Array.isArray(contract.signatures)) {
          for (const sig of contract.signatures) {
            if (sig?.signature_path) {
              presignTasks.push(
                getSignedGetUrl(String(sig.signature_path))
                  .then((url) => {
                    sig.signature_url = url;
                  })
                  .catch(() => {
                    sig.signature_url = null;
                  }),
              );
            }
          }
        }
      }
    }

    // company fetch + admin signature
    if (event.names_id) {
      const companyPromise = prisma.companyName
        .findUnique({ where: { id: BigInt(event.names_id) } })
        .catch(() => null)
        .then(async (company) => {
          if (!company) return null;
          if (company.admin_signature) {
            try {
              company.admin_signature_url = await getSignedGetUrl(String(company.admin_signature));
            } catch {
              company.admin_signature_url = null;
            }
          }
          return company;
        })
        .then((company) => {
          if (company) event.company_names = company;
        })
        .catch(() => {});
      presignTasks.push(companyPromise);
    }

    // contract_pdf_url
    if (event.contract_pdf_url) {
      presignTasks.push(
        (async () => {
          try {
            let key = null;
            try {
              const u = new URL(String(event.contract_pdf_url));
              key = u.pathname.replace(/^\//, "");
            } catch {
              key = String(event.contract_pdf_url);
            }
            if (key) {
              try {
                const signed = await getSignedGetUrl(key);
                event.contract_pdf_url = signed;
              } catch {
                // leave original
              }
            }
          } catch (e) {}
        })(),
      );
    }

    await Promise.allSettled(presignTasks);
  } catch (e) {
    // swallow presign errors (best-effort)
  }

  // attach notes and todos fetched in the transaction
  event.event_notes = notes || [];
  event.todos = todos || [];

  res.json(serializeForJson({ success: true, data: event }));
});

const sendInvoice = catchAsync(async (req, res) => {
  const body = req.validated || req.body || {};
  const userId = Number(body.id || body.userId) || null;
  let details = Array.isArray(body.details) ? body.details : [];
  const eventId = Number(
    body.event_id || (details[0] && details[0].id) || body.eventId || 0,
  );
  const companyId =
    Number(body.company_name_id || body.companyNameId || 0) || null;

  if (!eventId) return res.status(400).json({ error: "event_id_required" });

  // fetch event VAT/amount fields
  const event = await prisma.event.findUnique({ where: { id: eventId } });

  const enrichedDetails = details.map((d) => ({
    ...d,
    is_vat_available_for_the_event: event?.is_vat_available_for_the_event,
    event_amount_without_vat: event?.event_amount_without_vat,
    vat_value: event?.vat_value,
    total_cost_for_equipment: event?.total_cost_for_equipment,
  }));

  const user = userId
    ? await prisma.user.findUnique({ where: { id: userId } })
    : null;
  const to = user?.email || body.email || null;
  const company = companyId
    ? await prisma.companyName
        .findUnique({ where: { id: BigInt(companyId) } })
        .catch(() => null)
    : null;
  const companyName = company?.name || body.companyName || "";

  // load template
  const template = await prisma.emailContent
    .findFirst({ where: { email_name: "SEND INVOICE-CONFIRMED" } })
    .catch(() => null);
  const subject =
    body.subject || template?.subject || `Invoice for event #${eventId}`;
  let raw = body.body || template?.body || `Invoice for event ${eventId}`;
  if (raw && body.amount)
    raw = String(raw).replace("{--amount--}", String(body.amount));

  // render email/html for invoice (reuse quote renderer for layout parity)
  const fullEvent = await prisma.event
    .findUnique({
      where: { id: eventId },
      include: { users_events_user_idTousers: true, venues: true },
    })
    .catch(() => null);
  const first_name =
    details[0]?.user?.name ||
    fullEvent?.users_events_user_idTousers?.name ||
    "Client";
  const contract_token =
    details[0]?.contract_token || fullEvent?.contract_token || null;

  const companyDetails = {
    company_logo:
      company?.company_logo || company?.logo || company?.brochure || null,
    name: company?.name || "",
    vat: company?.vat ?? null,
    vat_percentage: company?.vat_percentage ?? null,
    contact_name: company?.contact_name || company?.contact || null,
    address_name: company?.address_name || null,
    street: company?.street || null,
    city: company?.city || null,
    postal_code: company?.postal_code || null,
    telephone_number: company?.telephone_number || company?.telephone || null,
    email: company?.email || null,
    website: company?.website || null,
    instagram: company?.instagram || null,
    facebook: company?.facebook || null,
  };

  const renderedBodyHtml = raw
    ? (function () {
        try {
          return raw;
        } catch (e) {
          return String(raw).replace(/\n/g, "<br>");
        }
      })()
    : "";
  // Render invoice HTML that more closely matches Laravel's pdf.invoice layout
  const invoiceHtml = renderInvoice({
    event: fullEvent || event,
    companyDetails,
    rawBody: raw || renderedBodyHtml,
    enrichedDetails,
  });

  // generate PDF buffer
  let pdfBuffer = null;
  try {
    pdfBuffer = await generatePdfBufferFromHtml(emailHtml);
  } catch (e) {
    console.error(
      "[confirmEvents.sendInvoice] PDF generation failed",
      e?.message || e,
    );
  }

  // upload PDF to S3 and get signed link
  let pdfKey = null;
  let pdfUrl = null;
  if (pdfBuffer) {
    const key = `invoices/${eventId}-${Date.now()}.pdf`;
    try {
      await uploadStreamToS3(pdfBuffer, key, "application/pdf");
      pdfKey = key;
      pdfUrl = await getSignedGetUrl(key);
    } catch (e) {
      console.error(
        "[confirmEvents.sendInvoice] PDF upload failed",
        e?.message || e,
      );
      pdfBuffer = null;
    }
  }

  // update event and send email (store S3 key, return presigned link in email)
  const result = await prisma.$transaction(async (tx) => {
    if (companyId)
      await tx.event.update({
        where: { id: eventId },
        data: { names_id: companyId, contract_pdf_url: pdfKey || undefined },
      });

    const finalHtml = pdfUrl
      ? `${invoiceHtml}<p><a href="${pdfUrl}">Download Invoice (PDF)</a></p>`
      : invoiceHtml;
    // format subject to match Laravel when company present
    const companyNameForSubject = company?.name || companyDetails?.name || "";
    const now = new Date();
    const subjectFormatted = companyNameForSubject
      ? `${companyNameForSubject} Invoice : ${String(now.getDate()).padStart(2, "0")}/${String(now.getMonth() + 1).padStart(2, "0")}/${now.getFullYear()}`
      : body.subject || template?.subject || `Invoice for event #${eventId}`;
    if (to)
      await sendEmail({ to, subject: subjectFormatted, html: finalHtml }).catch(
        () => {},
      );

    await eventNoteService.createNote(tx, {
      eventId,
      notes: `Invoice Sent - ${companyName}`,
      created_by: req.user?.id || null,
    });
    return await tx.event.findUnique({ where: { id: eventId } });
  });

  res.json(
    serializeForJson({
      message: "Invoice sent",
      event: result,
      pdfUrl: pdfUrl || null,
    }),
  );
});

const downloadInvoice = catchAsync(async (req, res) => {
  const params = req.validated || req.params || {};
  const eventId = Number(
    (params.params && params.params.id) || params.id || req.params.id || 0,
  );
  if (!eventId) return res.status(400).json({ error: "event_id_required" });

  const event = await prisma.event
    .findUnique({
      where: { id: eventId },
      include: { users_events_user_idTousers: true, venues: true },
    })
    .catch(() => null);
  if (!event) return res.status(404).json({ error: "event_not_found" });

  // company details if present
  let companyDetails = null;
  if (event.names_id) {
    companyDetails = await prisma.companyName
      .findUnique({ where: { id: BigInt(event.names_id) } })
      .catch(() => null);
  }

  // prepare invoice HTML using existing renderer
  const invoiceHtml = renderInvoice({
    event,
    companyDetails: companyDetails || {},
    rawBody: "",
    enrichedDetails: [],
  });

  let pdfBuffer = null;
  try {
    pdfBuffer = await generatePdfBufferFromHtml(invoiceHtml);
  } catch (e) {
    console.error(
      "[confirmEvents.downloadInvoice] PDF generation failed",
      e?.message || e,
    );
    return res.status(500).json({ error: "pdf_generation_failed" });
  }

  // To avoid environments that accidentally JSON-serialize Buffers,
  // return a JSON wrapper containing base64 PDF data. Frontend supports
  // both direct PDF blobs and this JSON { pdfBuffer } fallback.
  try {
    const base64 = pdfBuffer ? pdfBuffer.toString("base64") : null;
    return res.json(serializeForJson({ success: true, data: { pdfBuffer: base64, pdfUrl: null } }));
  } catch (e) {
    console.error("[confirmEvents.downloadInvoice] failed to send base64 PDF", e?.message || e);
    // Fallback: attempt to send raw buffer with PDF headers
    try {
      res.setHeader("Content-Type", "application/pdf");
      res.setHeader(
        "Content-Disposition",
        `attachment; filename=invoice-${eventId}.pdf`,
      );
      return res.send(pdfBuffer);
    } catch (err) {
      console.error("[confirmEvents.downloadInvoice] final fallback failed", err?.message || err);
      return res.status(500).json({ error: "pdf_send_failed" });
    }
  }
});

const refund = catchAsync(async (req, res) => {
  const params = req.query || {};
  const body =
    req.validated && req.validated.body ? req.validated.body : req.body || {};
  const eventId = Number(params.id || body.event_id || 0);
  const refundAmount = Number(body.refund_amount || body.amount || 0) || 0;

  if (!eventId) return res.status(400).json({ error: "event_id_required" });

  const event = await prisma.event.findUnique({ where: { id: eventId } });
  if (!event) return res.status(404).json({ error: "event_not_found" });

  const previous = event.refund_amount ? Number(event.refund_amount) : 0;
  const newRefund = previous + refundAmount;

  const updated = await prisma.$transaction(async (tx) => {
    await tx.event.update({
      where: { id: eventId },
      data: { refund_amount: newRefund },
    });
    // create a note recording the refund
    await eventNoteService
      .createNote(tx, {
        eventId,
        notes: `Refund processed - ${refundAmount}`,
        created_by: req.user?.id || null,
      })
      .catch(() => {});
    return await tx.event.findUnique({ where: { id: eventId } });
  });

  res.json(serializeForJson({ success: true, data: updated }));
});

const cancelEvent = catchAsync(async (req, res) => {
  const params = req.query || {};
  const body =
    req.validated && req.validated.body ? req.validated.body : req.body || {};
  const eventId = Number(params.id || body.event_id || 0);
  const refundAmount = Number(body.refund_amount || body.amount || 0) || 0;

  if (!eventId) return res.status(400).json({ error: "event_id_required" });

  const event = await prisma.event.findUnique({ where: { id: eventId } });
  if (!event) return res.status(404).json({ error: "event_not_found" });

  const previousRefund = event.refund_amount ? Number(event.refund_amount) : 0;
  const newRefundAmount = previousRefund + refundAmount;

  // find CANCELLED status id if available
  let cancelledStatusId = null;
  try {
    const statusRow = await prisma.event_statuses.findFirst({
      where: { status: "CANCELLED" },
    });
    if (statusRow && statusRow.id) cancelledStatusId = statusRow.id;
  } catch (e) {
    // ignore
  }

  const updated = await prisma.$transaction(async (tx) => {
    const data = { refund_amount: newRefundAmount };
    if (cancelledStatusId) data.event_status_id = cancelledStatusId;
    await tx.event.update({ where: { id: eventId }, data });

    await eventNoteService
      .createNote(tx, {
        eventId,
        notes: `Event cancelled - refund ${refundAmount}`,
        created_by: req.user?.id || null,
      })
      .catch(() => {});

    // best-effort: if there's a microsoft events table entry, attempt any cleanup (no-op here)
    return await tx.event.findUnique({ where: { id: eventId } });
  });
  // best-effort: delete any Microsoft calendar events and remove their DB records
  try {
    const msEvents = await prisma.microsoftEvent
      .findMany({ where: { event_id: BigInt(eventId) } })
      .catch(() => []);
    for (const me of msEvents || []) {
      try {
        if (me.microsoft_event_id) {
          await microsoftGraph
            .deleteEvent(me.microsoft_event_id)
            .catch(() => null);
        }
      } catch (e) {}
      try {
        await prisma.microsoftEvent
          .delete({ where: { id: me.id } })
          .catch(() => null);
      } catch (e) {}
    }
  } catch (e) {}

  // send cancellation emails to client and admins (best-effort)
  try {
    const eventRow = await prisma.event.findUnique({
      where: { id: eventId },
      include: { users_events_user_idTousers: true },
    });
    const user = eventRow?.users_events_user_idTousers || null;
    const template = await prisma.emailContent
      .findFirst({ where: { email_name: "EVENT CANCELLED" } })
      .catch(() => null);
    const subject = template?.subject || `Event Cancelled - #${eventId}`;
    const bodyHtml =
      template?.body ||
      `<p>Your event #${eventId} has been cancelled.</p>${refundAmount ? `<p>Refund: ${refundAmount}</p>` : ""}`;
    if (user && user.email) {
      await sendEmail({ to: [user.email], subject, html: bodyHtml }).catch(
        () => {},
      );
    }

    const admins = await prisma.user.findMany({
      where: { role_id: BigInt(2), is_email_send: true },
    });
    const adminEmails = admins.map((a) => a.email).filter(Boolean);
    if (adminEmails.length) {
      const adminHtml = `<p>Event #${eventId} was cancelled.</p><p>Refund: ${refundAmount}</p>`;
      await sendEmail({
        to: adminEmails,
        subject: `Event Cancelled - #${eventId}`,
        html: adminHtml,
      }).catch(() => {});
    }
  } catch (e) {}

  res.json(serializeForJson({ success: true, data: updated }));
});

// const updateEvent = catchAsync(async (req, res) => {
//   // Prefer validated payload from middleware; fall back to raw params/body
//   const payload = req.validated || {
//     params: req.params || {},
//     body: req.body || {},
//   };
//   const params = payload.params || {};
//   const body = payload.body || {};
//   const eventId = Number(params.id || 0);

//   // normalize date: accept Laravel-style 'Y-m-d' or 'DD-MM-YYYY'
//   let dateVal = null;
//   try {
//     if (body.date) {
//       const s = String(body.date).trim();
//       const ymd = /^\d{4}-\d{2}-\d{2}$/;
//       const dmy = /^\d{2}-\d{2}-\d{4}$/;
//       if (ymd.test(s)) {
//         const [y, m, d] = s.split("-").map((n) => Number(n));
//         if (!Number.isNaN(y) && !Number.isNaN(m) && !Number.isNaN(d)) {
//           dateVal = new Date(y, m - 1, d);
//         }
//       } else if (dmy.test(s)) {
//         const [dd, mm, yyyy] = s.split("-").map((n) => Number(n));
//         if (!Number.isNaN(dd) && !Number.isNaN(mm) && !Number.isNaN(yyyy)) {
//           dateVal = new Date(yyyy, mm - 1, dd);
//         }
//       }
//     }
//   } catch (e) {
//     dateVal = null;
//   }

//   // helper: convert date + HH:mm -> UTC Date
//   const parseTimeToUtcDate = (dateOnly, timeStr) => {
//     if (!timeStr) return null;
//     const [hh, mm] = String(timeStr)
//       .split(":")
//       .map((v) => Number(v));
//     if (Number.isNaN(hh) || Number.isNaN(mm)) return null;
//     const base = dateOnly instanceof Date ? dateOnly : new Date();
//     const local = new Date(
//       base.getFullYear(),
//       base.getMonth(),
//       base.getDate(),
//       hh,
//       mm,
//       0,
//     );
//     return new Date(local.toISOString());
//   };

//   const startTimeVal = parseTimeToUtcDate(dateVal, body.start_time);
//   const endTimeVal = parseTimeToUtcDate(dateVal, body.end_time);

//   const allowedEventFields = new Set([
//     "videography",
//     "caterer",
//     "decor",
//     "couple_name",
//     "entrance_song_style",
//     "cake_song_who_feeds",
//     "first_dance",
//     "do",
//     "date",
//     "start_time",
//     "end_time",
//     "venue_id",
//     "access_time",
//     "event_date_contact",
//     "no_of_guests",
//     "deposit_amount",
//     "brief_itinerary",
//     "stag_songs",
//     "hen_songs",
//     "dont",
//     "usr_name",
//     "usr_date",
//     "photo_usb_provided",
//     "guests_upstanding",
//     "refund_amount",
//   ]);

//   const eventUpdateData = {};
//   for (const key of Object.keys(body)) {
//     if (allowedEventFields.has(key)) {
//       // Prisma expects `no_of_guests` as a string in the DB schema.
//       if (key === "no_of_guests") {
//         eventUpdateData[key] = body[key] != null ? String(body[key]) : null;
//       } else {
//         eventUpdateData[key] = body[key];
//       }
//     }
//   }
//   // prevent overwriting created_by from client
//   if ("created_by" in eventUpdateData) delete eventUpdateData.created_by;
//   if (dateVal) eventUpdateData.date = dateVal;
//   if (startTimeVal) eventUpdateData.start_time = startTimeVal;
//   if (endTimeVal) eventUpdateData.end_time = endTimeVal;
//   // ensure access_time stored as provided or null
//   eventUpdateData.access_time = body.access_time
//     ? String(body.access_time)
//     : null;

//   // update user info (first_name, email, phone_number)
//   const userUpdateData = {};
//   if (body.first_name) userUpdateData.name = body.first_name;
//   if (body.email) userUpdateData.email = body.email;
//   if (body.phone_number)
//     userUpdateData.contact_number = String(body.phone_number);

//   let updated;
//   try {
//     updated = await prisma.$transaction(async (tx) => {
//       const ev = await tx.event.findUnique({ where: { id: eventId } });
//       if (!ev) return null;
//       if (Object.keys(userUpdateData).length && ev.user_id) {
//         try {
//           await tx.user.update({
//             where: { id: ev.user_id },
//             data: userUpdateData,
//           });
//         } catch (e) {
//           // Map Prisma unique-constraint to a clear error we can handle
//           if (e && e.code === "P2002") {
//             const err = new Error("email_in_use");
//             err.code = "EMAIL_IN_USE";
//             throw err;
//           }
//           throw e;
//         }
//       }

//       // best-effort: map dj_name to dj_id if provided
//       try {
//         if (body.dj_name) {
//           const djName = String(body.dj_name).trim();
//           let foundDj = await tx.user
//             .findFirst({ where: { name: djName } })
//             .catch(() => null);
//           if (!foundDj) {
//             foundDj = await tx.user
//               .findFirst({ where: { name: { contains: djName } } })
//               .catch(() => null);
//           }
//           if (foundDj && foundDj.id) {
//             eventUpdateData.dj_id = foundDj.id;
//           }
//         }
//       } catch (e) {}

//       const ev2 = await tx.event
//         .update({ where: { id: eventId }, data: eventUpdateData })
//         .catch(() => null);

//       console.log(ev2, "updated event");
//       // add event note
//       try {
//         await eventNoteService
//           .createNote(tx, {
//             eventId,
//             notes: "updated",
//             created_by: req.user?.id || null,
//           })
//           .catch(() => {});
//       } catch (e) {}

//       return ev2;
//     });
//   } catch (e) {
//     if (e && (e.code === "EMAIL_IN_USE" || e.code === "P2002")) {
//       return res.status(400).json({ error: "email_in_use" });
//     }
//     console.error("[updateEvent] transaction failed", e?.message || e);
//     return res.status(500).json({ error: "update_failed" });
//   }

//   if (!updated) return res.status(404).json({ error: "event_not_found" });

//   // best-effort: if we have a Microsoft calendar mapping, update the external event
//   try {
//     const fresh = await prisma.event.findUnique({
//       where: { id: eventId },
//       include: { users_events_user_idTousers: true, venues: true },
//     });
//     if (fresh) {
//       const ms = await prisma.microsoftEvent
//         .findFirst({ where: { event_id: BigInt(eventId) } })
//         .catch(() => null);
//       if (ms && ms.microsoft_event_id) {
//         const startIso = fresh.start_time
//           ? new Date(fresh.start_time).toISOString()
//           : fresh.date
//             ? new Date(fresh.date).toISOString()
//             : null;
//         const endIso = fresh.end_time
//           ? new Date(fresh.end_time).toISOString()
//           : fresh.date
//             ? new Date(fresh.date).toISOString()
//             : null;
//         const subject = `USRMusic Event #${fresh.id} - ${fresh.users_events_user_idTousers?.name || "Client"}`;
//         const content = fresh.details || "";
//         const location = fresh.venues?.venue || "";
//         await microsoftGraph
//           .updateEvent(ms.microsoft_event_id, {
//             subject,
//             content,
//             startIso,
//             endIso,
//             location,
//           })
//           .catch(() => null);
//       }
//     }
//   } catch (e) {}

//   res.json(serializeForJson({ success: true, data: updated }));
// });

const updateEvent = catchAsync(async (req, res) => {
  const payload = req.validated || {
    params: req.params || {},
    body: req.body || {},
  };
  const params = payload.params || {};
  const body = payload.body || {};
  const eventId = Number(params.id || 0);

  // 1. Normalize Date
  let dateVal = null;
  if (body.date) {
    const s = String(body.date).trim();
    const ymd = /^\d{4}-\d{2}-\d{2}$/; // YYYY-MM-DD
    const dmy = /^\d{2}-\d{2}-\d{4}$/; // DD-MM-YYYY
    if (ymd.test(s)) {
      const [y, m, d] = s.split("-").map(Number);
      dateVal = new Date(y, m - 1, d);
    } else if (dmy.test(s)) {
      const [dd, mm, yyyy] = s.split("-").map(Number);
      dateVal = new Date(yyyy, mm - 1, dd);
    }
  }

  // 2. Helper: Time to UTC
  const parseTimeToUtcDate = (dateOnly, timeStr) => {
    if (!timeStr || timeStr === "") return null;
    const [hh, mm] = String(timeStr).split(":").map(Number);
    if (isNaN(hh) || isNaN(mm)) return null;
    const base = dateOnly instanceof Date ? dateOnly : new Date();
    const local = new Date(base.getFullYear(), base.getMonth(), base.getDate(), hh, mm, 0);
    return new Date(local.toISOString());
  };

  const startTimeVal = parseTimeToUtcDate(dateVal, body.start_time);
  const endTimeVal = parseTimeToUtcDate(dateVal, body.end_time);

  // 3. Define Allowed Fields & Type Casting
  const allowedEventFields = new Set([
    "videography", "caterer", "decor", "couple_name", "entrance_song_style",
    "cake_song_who_feeds", "first_dance", "do", "dont", "date", "start_time",
    "end_time", "venue_id", "access_time", "event_date_contact", "no_of_guests",
    "deposit_amount", "brief_itinerary", "stag_songs", "hen_songs", "refund_amount"
  ]);

  const eventUpdateData = {};
  
  for (const key of Object.keys(body)) {
    if (allowedEventFields.has(key)) {
      const value = body[key];
      
      // Handle empty values
      if (value === "" || value === undefined || value === null) {
        eventUpdateData[key] = null;
        continue;
      }

      // Explicit Casting for Prisma
      if (key === "no_of_guests") {
        eventUpdateData[key] = String(value);
      } else if (key === "deposit_amount" || key === "refund_amount") {
        eventUpdateData[key] = parseFloat(value);
      } else if (key === "venue_id") {
        eventUpdateData[key] = parseInt(value, 10);
      } else {
        eventUpdateData[key] = value;
      }
    }
  }

  // Apply parsed dates/times
  if (dateVal) eventUpdateData.date = dateVal;
  if (startTimeVal) eventUpdateData.start_time = startTimeVal;
  if (endTimeVal) eventUpdateData.end_time = endTimeVal;

  // 4. Update User Data
  const userUpdateData = {};
  if (body.first_name) userUpdateData.name = body.first_name;
  if (body.email) userUpdateData.email = body.email;
  if (body.phone_number) userUpdateData.contact_number = String(body.phone_number);

  let updated;
  try {
    updated = await prisma.$transaction(async (tx) => {
      const ev = await tx.event.findUnique({ where: { id: eventId } });
      if (!ev) throw new Error("EVENT_NOT_FOUND");

      // Update linked User if details changed
      if (Object.keys(userUpdateData).length && ev.user_id) {
        await tx.user.update({
          where: { id: ev.user_id },
          data: userUpdateData,
        }).catch(e => {
          if (e.code === 'P2002') throw new Error("EMAIL_IN_USE");
          throw e;
        });
      }

      // Best-effort DJ mapping
      if (body.dj_name) {
        const djName = String(body.dj_name).trim();
        const foundDj = await tx.user.findFirst({
          where: { name: { contains: djName } }
        });
        if (foundDj) eventUpdateData.dj_id = foundDj.id;
      }

      // CRITICAL: Perform the update without the silent .catch()
      const result = await tx.event.update({
        where: { id: eventId },
        data: eventUpdateData,
      });

      // Log the update note
      await eventNoteService.createNote(tx, {
        eventId,
        notes: "Event details updated via management portal",
        created_by: req.user?.id || null,
      }).catch(() => {});

      return result;
    });
  } catch (e) {
    if (e.message === "EMAIL_IN_USE") return res.status(400).json({ error: "email_in_use" });
    if (e.message === "EVENT_NOT_FOUND") return res.status(404).json({ error: "event_not_found" });
    
    console.error("[updateEvent] Transaction Error:", e);
    return res.status(500).json({ error: "update_failed", details: e.message });
  }

  // 5. External Sync (Microsoft Graph)
  try {
    const fresh = await prisma.event.findUnique({
      where: { id: eventId },
      include: { users_events_user_idTousers: true, venues: true },
    });
    
    const ms = await prisma.microsoftEvent.findFirst({ where: { event_id: BigInt(eventId) } });
    
    if (ms?.microsoft_event_id && fresh) {
      await microsoftGraph.updateEvent(ms.microsoft_event_id, {
        subject: `Event #${fresh.id} - ${fresh.users_events_user_idTousers?.name || "Client"}`,
        content: fresh.brief_itinerary || "",
        startIso: fresh.start_time?.toISOString() || fresh.date?.toISOString(),
        endIso: fresh.end_time?.toISOString() || fresh.date?.toISOString(),
        location: fresh.venues?.venue || "",
      }).catch(err => console.error("MS Graph Sync Failed:", err));
    }
  } catch (e) {
    console.error("Post-update sync error:", e);
  }

  res.json({ success: true, data: serializeForJson(updated) });
});

export default {
  confirmEvent,
  listConfirmEvents,
  listCompletedConfirmEvents,
  getConfirmEvent,
  sendEventConfirmationEmail,
  sendInvoice,
  downloadInvoice,
  updateEvent,
  refund,
  cancelEvent,
};
