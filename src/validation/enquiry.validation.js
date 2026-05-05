import Joi from "joi";

const dateRegex = /^\d{2}-\d{2}-\d{4}$/; // DD-MM-YYYY
const timeRegex = /^(?:[01]\d|2[0-3]):[0-5]\d$/; // HH:mm

const allowedSortFields = [
  "date",
  "id",
  "usr_name",
  "usr_date",
  "created_at",
  "updated_at",
  "total_cost_for_equipment",
];

const listOpenEnquiries = Joi.object({
  query: Joi.object({
    search: Joi.string().trim().max(100).allow("", null),
    page: Joi.number().integer().min(1).default(1),
    limit: Joi.number().integer().min(1).max(100).default(10),
    sortBy: Joi.string()
      .valid(...allowedSortFields)
      .optional()
      .allow("", null),
    sortOrder: Joi.string().valid("asc", "desc").optional().default("asc"),
  }).unknown(true),
});

const equipmentItem = Joi.object({
  equipment_id: Joi.number().integer().allow(null),
  equipment_order_id: Joi.number().integer().allow(null),
  sell_price: Joi.number().allow(null),
  cost_price: Joi.number().allow(null),
  price_added_to_bill: Joi.number().allow(null),
  quantity: Joi.number().integer().allow(null),
  total_price: Joi.number().allow(null),
  notes: Joi.string().allow("", null),
});

const createEnquiry = Joi.object({
  body: Joi.object({
    name: Joi.string().required(),
    email: Joi.string().email().required(),
    contact_number: Joi.string().required(),
    address: Joi.string().required(),
    dj_id: Joi.number().integer().allow(null),
    event_date: Joi.string().pattern(dateRegex).required(),
    start_time: Joi.string().pattern(timeRegex).required(),
    end_time: Joi.string().pattern(timeRegex).required(),
    deposit_amount: Joi.number().allow(null),
    venue_id: Joi.number().integer().optional(),
    new_venue_name: Joi.string().allow("", null).optional(),
    event_details: Joi.string().allow("", null),
    dj_name: Joi.string().allow("", null),
    dj_package_name: Joi.string().allow("", null),
    total_cost: Joi.number().allow(null),
    dj_cost: Joi.number().allow(null),
    no_of_guests: Joi.alternatives()
      .try(Joi.number().integer(), Joi.string())
      .allow(null),
    guestCount: Joi.alternatives()
      .try(Joi.number().integer(), Joi.string())
      .allow(null),
    equipment_data: Joi.array().items(equipmentItem).allow(null),
    extra_data: Joi.array().items(equipmentItem).allow(null),
    rig_notes_data: Joi.array()
      .items(
        Joi.object({
          equipment_id: Joi.number().integer().allow(null),
          rig_notes: Joi.string().allow("", null),
        }),
      )
      .allow(null),
    client_id: Joi.number().integer().optional().when("is_new_client", {
      is: true,
      then: Joi.forbidden(),
      otherwise: Joi.optional(),
    }),
    is_new_client: Joi.boolean().optional(),
  }).unknown(true),
});

// const sendInvoice = sendQuote.keys({});

const deleteOpenEnquiry = Joi.object({
  body: Joi.object({
    ids: Joi.alternatives()
      .try(Joi.array().items(Joi.number().integer()), Joi.string())
      .required(),
    userId: Joi.number().integer().optional(),
  }).unknown(true),
});

const staffEquipment = Joi.object({
  params: Joi.object({
    staff: Joi.string().required(),
    package_name: Joi.string().required(),
    event_date: Joi.string().pattern(dateRegex).required(),
  }),
});

const addNote = Joi.object({
  params: Joi.object({
    id: Joi.number().integer().optional(),
  }).unknown(true),
  query: Joi.object({
    id: Joi.number().integer().optional(),
  }).unknown(true),
  body: Joi.object({
    note: Joi.string().required(),
  }).unknown(true),
});

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

const updateEnquiry = Joi.object({
  params: Joi.object({
    id: Joi.number().integer().required(),
  }),
  body: Joi.object({
    name: Joi.string(),
    email: Joi.string().email(),
    contact_number: Joi.string(),
    address: Joi.string(),
    brochure_emailed: Joi.boolean(),
    called: Joi.boolean(),
    send_media: Joi.boolean(),
    quoted: Joi.boolean(),
    event_date: Joi.string().pattern(dateRegex),
    start_time: Joi.string().pattern(timeRegex),
    end_time: Joi.string().pattern(timeRegex),
    deposit_amount: Joi.number().allow(null),
    venue_id: Joi.number().integer(),
    new_venue_name: Joi.string().allow("", null),
    event_details: Joi.string().allow("", null),
    dj_name: Joi.string().allow("", null),
    dj_id: Joi.number().integer().allow(null),
    dj_package_name: Joi.string().allow("", null),
    total_cost: Joi.number().allow(null),
    dj_cost: Joi.number().allow(null),
    equipment_data: Joi.array().items(equipmentItem).allow(null),
    extra_data: Joi.array().items(equipmentItem).allow(null),
    no_of_guests: Joi.alternatives()
      .try(Joi.number().integer(), Joi.string())
      .allow(null),
    guestCount: Joi.alternatives()
      .try(Joi.number().integer(), Joi.string())
      .allow(null),
    rig_notes_data: Joi.array()
      .items(
        Joi.object({
          equipment_id: Joi.number().integer().allow(null),
          rig_notes: Joi.string().allow("", null),
        }),
      )
      .allow(null),
  }),
});

const deleteEnquiry = Joi.object({
  params: Joi.object({
    id: Joi.number().integer().required(),
  }),
});

const deleteManyEnquiries = Joi.object({
  params: Joi.object({
    // Accept either an array of numbers or a comma-separated string like "1,2,3"
    ids: Joi.alternatives()
      .try(
        Joi.array().items(Joi.number().integer()),
        Joi.string().pattern(/^\d+(?:,\d+)*$/),
      )
      .required(),
  }),
});
const getEnquiry = Joi.object({
  params: Joi.object({
    id: Joi.number().integer().required(),
  }),
});

export default {
  listOpenEnquiries,
  createEnquiry,
  deleteOpenEnquiry,
  staffEquipment,
  addNote,
  getEmail,
  sendEmail,
  updateEnquiry,
  getEnquiry,
  deleteEnquiry,
  deleteManyEnquiries,
};
