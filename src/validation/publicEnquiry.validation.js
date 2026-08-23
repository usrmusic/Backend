import Joi from "joi";

// Public, unauthenticated intake for the new website enquiry form (a public
// Next.js page that replaces the old Squarespace iframe target). Same 5 core
// fields the legacy Laravel form collects (name, email, contact_number,
// event_date, event_details), plus the 2 new ones added to this form
// (event_type, venue). event_date is intentionally loose (not the
// DD-MM-YYYY the internal authenticated /enquiry endpoint requires) since
// the form's <input type="date"> sends YYYY-MM-DD; toDbDate() in the
// controller already handles both.
const createPublicEnquiry = Joi.object({
  body: Joi.object({
    // Max lengths mirror the actual DB column widths (schema.prisma) so a
    // too-long value gets a clean 400 here instead of a raw Prisma/MySQL
    // truncation error: User.name VarChar(60), User.email VarChar(60),
    // User.contact_number VarChar(18), Venue.venue VarChar(50).
    name: Joi.string().trim().min(1).max(60).required(),
    email: Joi.string().trim().email().max(60).required(),
    contact_number: Joi.string().trim().min(1).max(18).required(),
    event_date: Joi.string().trim().min(1).required(),
    event_details: Joi.string().allow("", null),
    event_type: Joi.string().trim().max(100).allow("", null),
    venue: Joi.string().trim().max(50).allow("", null),
    // Honeypot: a hidden field real visitors never see or fill in. The
    // controller treats any non-empty value as a bot and silently no-ops.
    // Named blandly on purpose — an obvious "honeypot" name is the first
    // thing a scraping bot filters out.
    company_website: Joi.string().allow("", null),
  }),
});

export default { createPublicEnquiry };
