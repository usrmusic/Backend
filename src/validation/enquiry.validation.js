import Joi from "joi";

const dateRegex = /^\d{2}-\d{2}-\d{4}$/; // DD-MM-YYYY
const timeRegex = /^(?:[01]\d|2[0-3]):[0-5]\d$/; // HH:mm

const clientSchema = Joi.object({
  id: Joi.number().integer(),
  email: Joi.string().email(),
  name: Joi.string().allow('', null),
  contact_number: Joi.string().allow('', null),
  address: Joi.string().allow('', null),
});

const equipmentItem = Joi.object({
  equipment_id: Joi.number().integer().allow(null),
  equipment_order_id: Joi.number().integer().allow(null),
  sell_price: Joi.number().allow(null),
  cost_price: Joi.number().allow(null),
  price_added_to_bill: Joi.number().allow(null),
  quantity: Joi.number().integer().allow(null),
  total_price: Joi.number().allow(null),
});

const arrayOrMapOfEquipment = Joi.alternatives().try(
  Joi.array().items(equipmentItem),
  Joi.object().pattern(Joi.string(), equipmentItem)
);

const createEnquiry = Joi.object({
  body: Joi.object({
    name: Joi.string().required(),
    email: Joi.string().email().required(),
    contact_number: Joi.string().required(),
    address: Joi.string().required(),
    event_date: Joi.string().pattern(dateRegex).required(),
    start_time: Joi.string().pattern(timeRegex).required(),
    end_time: Joi.string().pattern(timeRegex).required(),
    deposit_ammount: Joi.number().allow(null),
    venue_id: Joi.number().integer().required(),
    new_venue_name: Joi.number().integer().allow(null),
    event_details: Joi.string().allow('', null),
    dj_name: Joi.string().allow('', null),
    dj_package_name: Joi.string().allow('', null),
    total_cost: Joi.number().allow(null),
    dj_cost: Joi.number().allow(null),
    equipmentData: arrayOrMapOfEquipment,
    extra_data: arrayOrMapOfEquipment,
    rig_notes_data: Joi.array().items(Joi.object({
      equipment_id: Joi.number().integer().allow(null),
      rig_note: Joi.string().allow('', null),
    })).allow(null),
  }),
});

const sendBrochure = Joi.object({
  body: Joi.object({
    id: Joi.number().integer().optional(),
    userId: Joi.number().integer().optional(),
    eventId: Joi.number().integer().optional(),
    event_id: Joi.number().integer().optional(),
    companyNameId: Joi.number().integer().optional(),
    companyId: Joi.number().integer().optional(),
    companyName: Joi.string().optional(),
    subject: Joi.string().optional(),
    body: Joi.string().optional(),
    email: Joi.string().email().optional(),
  }).unknown(true),
});

const sendQuote = Joi.object({
  body: Joi.object({
    id: Joi.number().integer().optional(),
    userId: Joi.number().integer().optional(),
    details: Joi.array().items(Joi.object({ id: Joi.number().integer().required(), amount: Joi.number().optional() })).required(),
    companyNameId: Joi.number().integer().optional(),
    companyId: Joi.number().integer().optional(),
    companyName: Joi.string().optional(),
    subject: Joi.string().optional(),
    body: Joi.string().optional(),
    email: Joi.string().email().optional(),
  }).unknown(true),
});

const sendInvoice = sendQuote.keys({});

const deleteOpenEnquiry = Joi.object({
  body: Joi.object({
    ids: Joi.alternatives().try(
      Joi.array().items(Joi.number().integer()),
      Joi.string()
    ).required(),
    userId: Joi.number().integer().optional(),
  }).unknown(true),
});

const addDepositStore = Joi.object({
  body: Joi.object({
    event_id: Joi.number().integer().required(),
    payment_method_id: Joi.number().integer().required(),
    amount: Joi.number().required(),
    names_id: Joi.alternatives().try(Joi.number().integer(), Joi.string()).required(),
    details: Joi.alternatives().try(Joi.string(), Joi.object()).required(),
    date: Joi.date().optional(),
  }).unknown(true),
});

const staffEquipment = Joi.object({
  params: Joi.object({
    staff: Joi.string().required(),
    package_name: Joi.string().required(),
    event_date: Joi.string().pattern(dateRegex).required(),
  }),
})

export default {
  createEnquiry,
  sendBrochure,
  sendQuote,
  sendInvoice,
  deleteOpenEnquiry,
  addDepositStore,
  staffEquipment,
};
