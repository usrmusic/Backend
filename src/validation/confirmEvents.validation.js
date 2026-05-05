import Joi from "joi";

const dateRegex = /^\d{2}-\d{2}-\d{4}$/; // DD-MM-YYYY
const timeRegex = /^(?:[01]\d|2[0-3]):[0-5]\d$/; // HH:mm

const getEmail = Joi.object({
  query: Joi.object({
    email_name: Joi.string().required(),
    event_id: Joi.number().integer().required(),
  }),
});

const sendEmail = Joi.object({
  body: Joi.object({
    event_id: Joi.number().integer().required(),
    body: Joi.string().required(),
    subject: Joi.string().required(),
    company_name_id: Joi.number().integer().required(),
  }),
});

const listConfirmEvents = Joi.object({
  query: Joi.object({
    search: Joi.string().trim().max(100).allow("", null),
    perPage: Joi.number().integer().min(1).max(100).default(10),
    page: Joi.number().integer().min(1).default(1),
    paymentStatus: Joi.string().valid("completed", "pending").optional(),
  }),
});

const confirmEvent = Joi.object({
  params: Joi.object({
    id: Joi.number().integer().required(),
  }),
  body: Joi.object({
    event_date: Joi.string().pattern(dateRegex).required(),
    company_name: Joi.string().required(),
    deposit_amount: Joi.number().required(),
    payment_method_id: Joi.number().integer().required(),
  }),
});

const getConfirmEvent = Joi.object({
  params: Joi.object({
    id: Joi.number().integer().required(),
  }),
});

const refund = Joi.object({
  query: Joi.object({
    id: Joi.number().integer().required(),
  }),
  body: Joi.object({
    refund_amount: Joi.number().required(),
  }),
});

const cancel = Joi.object({
  query: Joi.object({ id: Joi.number().integer().required() }),
  body: Joi.object({ refund_amount: Joi.number().optional() }),
});

const downloadInvoice = Joi.object({
  params: Joi.object({
    id: Joi.number().integer().required(),
  }),
});

const updateEvent = Joi.object({
  params: Joi.object({
    id: Joi.number().integer().required(),
  }),
  body: Joi.object({
    // User Info
    first_name: Joi.string().allow('', null).optional(),
    email: Joi.string().email().allow('', null).optional(),
    phone_number: Joi.number().integer().optional(), // Numbers don't use .allow('')

    // DJ & Vendors
    dj_name: Joi.string().allow('', null).optional(),
    videography: Joi.string().allow('', null).optional(),
    caterer: Joi.string().allow('', null).optional(),
    decor: Joi.string().allow('', null).optional(),

    // Event Details
    couple_name: Joi.string().allow('', null).optional(),
    date: Joi.string().pattern(dateRegex).optional(),
    start_time: Joi.string().pattern(timeRegex).optional(),
    end_time: Joi.string().pattern(timeRegex).optional(),
    venue: Joi.string().allow('', null).optional(),
    venue_id: Joi.number().integer().allow(null).optional(),
    access_time: Joi.string().allow('', null).optional(),
    event_date_contact: Joi.string().allow('', null).optional(),
    no_of_guests: Joi.number().allow(null).optional(),
    deposit_amount: Joi.number().allow(null).optional(), // Must be a number, but can be null
    refund_amount: Joi.number().allow(null).optional(),

    // Music & Itinerary
    entrance_song_style: Joi.string().allow('', null).optional(),
    cake_song_who_feeds: Joi.string().allow('', null).optional(),
    first_dance: Joi.string().allow('', null).optional(),
    brief_itinerary: Joi.string().allow('', null).optional(),
    stag_songs: Joi.string().allow('', null).optional(),
    hen_songs: Joi.string().allow('', null).optional(),

    // Preferences & Notes
    do: Joi.string().allow('', null).optional(),
    dont: Joi.string().allow('', null).optional(),
    usr_name: Joi.string().allow('', null).optional(),
    usr_date: Joi.string().allow('', null).optional(),
    photo_usb_provided: Joi.string().allow('', null).optional(),
    guests_upstanding: Joi.string().allow('', null).optional(),
    created_by: Joi.string().allow('', null).optional(),

    // Optional inline contract signature (admin or owning client)
    signature_image: Joi.string().pattern(/^data:image\//).allow(null, '').optional(),
  }),
});

const addPayment = Joi.object({
    query: Joi.object({ id: Joi.number().integer().required() }),
    body: Joi.object({
      payment_method_id: Joi.number().integer().required(),
      date: Joi.date().iso().required(),
      amount: Joi.number().required(),
    })
})
export default {
  listConfirmEvents,
  confirmEvent,
  getConfirmEvent,
  sendEmail,
  getEmail,
  refund,
  addPayment,
  downloadInvoice,
  updateEvent,
  cancel,
};
