import prisma from "../utils/prismaClient.js";
import catchAsync from "../utils/catchAsync.js";
import { serializeForJson } from "../utils/serialize.js";
import { v4 as uuidv4 } from "uuid";
import { toDbDate } from "../utils/dateUtils.js";
import sendEmail from "../utils/mail/resendClient.js";
import { buildPublicEnquiryAdminEmail } from "../utils/mail/templates/publicEnquiryAdminEmail.js";
import eventNoteService from "../services/eventNoteService.js";
import services from "../services/index.js";
import genPassword from "../utils/genPassword.js";
import userService from "../services/userService.js";
import bcrypt from "bcrypt";
import { logActivity } from "../utils/activityLogger.js";

const userSvc = services.get("user");
const venueSvc = services.get("venue");
const eventSvc = services.get("event");

// Strip everything but letters/digits and lowercase, so "Grand Station",
// "GrandStation" and "grandstation" all collapse to the same key. Cheap and
// dependency-free for a venues table that's small enough to fetch in full.
function normalizeVenueName(s) {
  return String(s || "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}

// Reuses an existing venue whose normalized name matches (exactly, or as a
// substring either direction) the typed-in name, instead of creating a new
// row per submission — a public lead-capture form will get the same venue
// typed slightly differently across enquiries.
async function findOrCreateVenue(venueName) {
  const trimmed = String(venueName || "").trim();
  if (!trimmed) return null;

  const normalizedInput = normalizeVenueName(trimmed);
  if (!normalizedInput) return null;

  const existingVenues = await prisma.venue.findMany({
    select: { id: true, venue: true },
  });
  const match = existingVenues.find((v) => {
    const normalizedExisting = normalizeVenueName(v.venue);
    if (!normalizedExisting) return false;
    return (
      normalizedExisting === normalizedInput ||
      normalizedExisting.includes(normalizedInput) ||
      normalizedInput.includes(normalizedExisting)
    );
  });
  if (match) return match;

  try {
    return await venueSvc.create({ venue: trimmed, created_by: null });
  } catch (e) {
    console.error("[createPublicEnquiry] create venue failed", e?.message || e);
    return null;
  }
}

// Public, unauthenticated counterpart to enquiry.controller.js#createEnquiry.
// Backs the new website enquiry form (a public Next.js page replacing the
// old Squarespace iframe target). No req.user (no session), no venue_id
// picker, no DJ/equipment — just the lead-capture fields a website visitor
// fills in.
//
// Deliberately always creates a NEW Event row rather than finding-and-updating
// an existing open enquiry for this client — this is a public, unauthenticated
// endpoint, and merging into an existing event risks silently overwriting
// something staff are already working on. A duplicate lead from a resubmit
// is harmless (staff can merge manually); clobbering existing data isn't.
const createPublicEnquiry = catchAsync(async (req, res) => {
  const data = req.body;

  // Honeypot: real visitors never see/fill this field. A bot that fills
  // every input will. Return a fake success so it doesn't learn it's been
  // caught and try a smarter bypass.
  if (data.company_website) {
    return res.status(201).json({ success: true, message: "Enquiry submitted successfully" });
  }

  const venue = data.venue ? await findOrCreateVenue(data.venue) : null;

  const existingByEmail = await userService.getUserByEmail(data.email);
  let client = null;
  if (existingByEmail) {
    const isClientRole =
      existingByEmail.role_id === BigInt(4) || String(existingByEmail.role_id) === "4";
    if (!isClientRole) {
      return res.status(400).json({ error: "This email is already attached with Dj" });
    }
    if (existingByEmail.deleted_at) {
      await userSvc.update(existingByEmail.id, { deleted_at: null });
    }
    client = existingByEmail;
  } else {
    const plainPassword = genPassword();
    const hashed = await bcrypt.hash(plainPassword, 10);
    client = await userSvc.create({
      name: data.name,
      email: data.email,
      contact_number: data.contact_number,
      password: hashed,
      password_text: plainPassword,
      role_id: BigInt(4),
      created_by: null,
    });
  }

  const eventDateDb = toDbDate(data.event_date);
  const eventDateObj = eventDateDb ? new Date(eventDateDb) : null;

  const event = await eventSvc.create({
    date: eventDateObj,
    event_type: data.event_type || null,
    details: data.event_details || null,
    venue_id: venue?.id || null,
    user_id: Number(client.id),
    created_by: null,
    contract_token: uuidv4(),
    event_status_id: 1,
  });
  await eventNoteService.createNote(prisma, {
    eventId: Number(event.id),
    notes: "Created as an enquiry via website form",
    created_by: null,
  });

  const admins = await prisma.user.findMany({
    where: { role_id: BigInt(2), is_email_send: true },
  });
  const adminEmails = admins.map((a) => a.email);
  const { subject, html } = buildPublicEnquiryAdminEmail({
    name: client.name,
    email: client.email,
    contact_number: client.contact_number,
    event_date: data.event_date,
    event_type: data.event_type,
    venue: venue ? venue.venue : data.venue,
    event_details: data.event_details,
  });
  await sendEmail({ to: adminEmails, subject, html }).catch(() => {});

  await logActivity(prisma, {
    log_name: "public enquiry created",
    description: `Public enquiry submitted for ${client.name}`,
    subject_type: "Event",
    subject_id: Number(event.id),
    causer_id: null,
    properties: { client_name: client.name, source_ip: req.ip || null },
  });

  res.status(201).json(
    serializeForJson({
      success: true,
      message: "Enquiry submitted successfully",
      event,
      client,
      venue,
    }),
  );
});

export default { createPublicEnquiry };
