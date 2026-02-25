import Joi from 'joi';

// Schema for Create Enquiry payload
const equipmentItem = Joi.object({
  equipment_id: Joi.number().integer().positive().optional().allow(null),
  equipment_order_id: Joi.number().integer().optional().allow(null),
  package_user_id: Joi.number().integer().optional().allow(null),
  package_type_id: Joi.number().integer().optional().allow(null),
  sell_price: Joi.number().optional().allow(null),
  cost_price: Joi.number().optional().allow(null),
  notes: Joi.string().optional().allow('', null),
  rig_notes: Joi.string().optional().allow('', null),
  payment_send: Joi.string().optional().allow('', null),
  payment_date: Joi.date().optional().allow(null),
  quantity: Joi.number().integer().optional().allow(null),
  total_price: Joi.number().optional().allow(null),
  price_added_to_bill: Joi.number().optional().allow(null),
});

const enquirySchema = Joi.object({
  client: Joi.alternatives().try(
    Joi.object({ id: Joi.number().integer().positive().required() }),
    Joi.object({ name: Joi.string().required(), email: Joi.string().email().optional(), contact_number: Joi.string().optional(), address: Joi.string().optional() })
  ).required(),
  client_id: Joi.number().integer().positive().optional(),
  venue_id: Joi.number().integer().positive().required(),
  user_id: Joi.number().integer().positive().optional(),
  dj_id: Joi.number().integer().positive().required(),
  event_date: Joi.string().pattern(/^\d{4}-\d{2}-\d{2}$|^\d{2}-\d{2}-\d{4}$/).required(),
  start_time: Joi.string().pattern(/^\d{2}:\d{2}$/).required(),
  end_time: Joi.string().pattern(/^\d{2}:\d{2}$/).required(),
  timezone: Joi.string().optional().allow('', null),
  equipmentData: Joi.array().items(equipmentItem).optional().allow(null),
  extraData: Joi.array().items(equipmentItem).optional().allow(null),
  rigNotesData: Joi.array().items(Joi.object({ equipment_id: Joi.number().integer().positive().required(), rig_notes: Joi.string().allow('', null) })).optional().allow(null),
  rig_notes: Joi.string().optional().allow('', null),
  notes: Joi.string().optional().allow('', null),
  totalCost: Joi.number().optional().allow(null),
  dj_cost_price: Joi.number().optional().allow(null),
  deposit_amount: Joi.number().optional().allow(null),
  is_vat_available_for_the_event: Joi.boolean().optional(),
});

// Schema for updating open enquiry flags and delete payload
export const openUpdateSchema = Joi.object({
  id: Joi.number().integer().positive().required(),
  brochure_emailed: Joi.boolean().optional(),
  called: Joi.boolean().optional(),
  send_media: Joi.boolean().optional(),
  quoted: Joi.boolean().optional(),
  ids: Joi.alternatives().try(Joi.array().items(Joi.number().integer().positive()), Joi.number().integer().positive()).optional(),
  userId: Joi.number().integer().optional(),
});

// Schema for send endpoints (brochure/update/quote/invoice)
export const openSendSchema = Joi.object({
  id: Joi.number().integer().positive().required(), // user id
  eventId: Joi.number().integer().positive().optional(),
  event_id: Joi.number().integer().positive().optional(),
  companyNameId: Joi.number().integer().positive().optional(),
  companyId: Joi.number().integer().positive().optional(),
  companyName: Joi.string().optional().allow('', null),
  subject: Joi.string().optional().allow('', null),
  body: Joi.string().optional().allow('', null),
  details: Joi.array().items(Joi.object({ id: Joi.number().integer().required() })).optional().allow(null),
  email: Joi.string().email().optional(),
});

export default enquirySchema;

// Schema for confirm (add deposit + confirm event)
export const openConfirmSchema = Joi.object({
  event_id: Joi.number().integer().positive().required(),
  payment_method_id: Joi.number().integer().positive().required(),
  amount: Joi.number().required(),
  date: Joi.date().optional(),
  names_id: Joi.number().integer().positive().required(),
  details: Joi.array().items(Joi.object({ id: Joi.number().integer().required() })).required(),
  invoice_number: Joi.string().optional(),
});
