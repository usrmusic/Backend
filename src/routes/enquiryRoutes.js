import express from 'express';
import enquiryController from '../controllers/enquiryController.js';
import validate from '../validation/validate.js';
import enquirySchema, { openUpdateSchema, openSendSchema, openConfirmSchema } from '../validation/enquirySchema.js';

const router = express.Router();

// create enquiry (validate body with Joi)
router.post('/', validate(enquirySchema), enquiryController.createEnquiry);

// Open enquiries
router.get('/open', enquiryController.getOpenEnquiry);
router.post('/open', validate(openUpdateSchema), enquiryController.updateOpenEnquiry);
router.post('/open/send-brochure', validate(openSendSchema), enquiryController.sendUsrBrochure);
router.post('/open/send-update', validate(openSendSchema), enquiryController.sendUsrUpdateEmail);
router.post('/open/send-quote', validate(openSendSchema), enquiryController.sendQuote);
router.post('/open/send-invoice', validate(openSendSchema), enquiryController.sendInvoice);
router.delete('/open', validate(openUpdateSchema), enquiryController.deleteOpenEnquiry);
router.post('/open/confirm', validate(openConfirmSchema), enquiryController.addDepositStore);

export default router;
