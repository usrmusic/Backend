import prisma from "../utils/prismaClient.js";
import catchAsync from "../utils/catchAsync.js";
import { serializeForJson } from "../utils/serialize.js";
import { v4 as uuidv4 } from "uuid";
import { toDbDate } from "../utils/dateUtils.js";
import sendEmail from "../utils/mail/resendClient.js";
import eventNoteService from "../services/eventNoteService.js";
import services from "../services/index.js";
import genPassword from "../utils/genPassword.js";
import userService from "../services/userService.js";
import bcrypt from "bcrypt";

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
// fills in. There is no event_type column on Event, so it's folded into the
// same `details` text field the internal form's "event_details" already
// writes to, rather than adding a migration for a single free-text label.
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

  const details = data.event_type
    ? `Event Type: ${data.event_type}\n\n${data.event_details || ""}`.trim()
    : data.event_details || null;

  const event = await eventSvc.create({
    date: eventDateObj,
    details,
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
  await sendEmail({
    to: adminEmails,
    subject: "New Website Enquiry",
    html: `A new enquiry has been submitted through the website form:<br>
    Name: ${client.name}<br>
    Email: ${client.email}<br>
    Contact Number: ${client.contact_number}<br>
    Event Date: ${data.event_date}<br>
    Event Type: ${data.event_type || "N/A"}<br>
    Venue: ${venue ? venue.venue : data.venue || "N/A"}<br>
    Tell us more: ${data.event_details || "N/A"}<br>
    `,
  }).catch(() => {});

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
