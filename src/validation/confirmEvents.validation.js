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
    first_name: Joi.string().required(),
    email: Joi.string().email().required(),
    phone_number: Joi.number().integer().required(),
    dj_name: Joi.string().optional(),
    videography: Joi.string().required(),
    caterer: Joi.string().optional(),
    decor: Joi.string().optional(),
    couple_name: Joi.string().required(),
    entrance_song_style: Joi.string().optional(),
    cake_song_who_feeds: Joi.string().optional(),
    first_dance: Joi.string().optional(),
    do: Joi.string().optional(),
    date: Joi.string().pattern(dateRegex).required(),
    start_time: Joi.string().pattern(timeRegex).required(),
    end_time: Joi.string().pattern(timeRegex).required(),
    venue: Joi.string().optional(),
    venue_id: Joi.number().integer().optional(),
    access_time: Joi.string().optional(),
    event_date_contact: Joi.string().optional(),
    no_of_guests: Joi.number().optional(),
    deposit_amount: Joi.number().optional(),
    created_by: Joi.string().optional(),
    brief_itinerary: Joi.string().optional(),
    stag_songs: Joi.string().optional(),
    hen_songs: Joi.string().optional(),
    dont: Joi.string().optional(),
    usr_name: Joi.string().optional(),
    usr_date: Joi.string().optional(),
    photo_usb_provided: Joi.string().optional(),
    guests_upstanding: Joi.string().optional(),
    refund_amount: Joi.number().optional(),
  }),
});

export default {
  listConfirmEvents,
  confirmEvent,
  getConfirmEvent,
  sendEmail,
  getEmail,
  refund,
  downloadInvoice,
  updateEvent,
  cancel,
};
