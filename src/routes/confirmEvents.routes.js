import express from 'express';
import { verifyAccessToken } from '../middleware/auth0.js';
import validate from '../middleware/validate.js';
import { checkPermission } from '../middleware/authorize.js';
import { confirmEventsController } from '../controllers/index.js';
import {confirmEventsValidation } from '../validation/index.js'


const router = express.Router();


router.route('/')
  .get(verifyAccessToken, checkPermission("manage all"), validate(confirmEventsValidation.listConfirmEvents), confirmEventsController.listConfirmEvents)

router.route('/:id')
  .get(verifyAccessToken, checkPermission("manage all"), validate(confirmEventsValidation.getConfirmEvent), confirmEventsController.getConfirmEvent)
  .post(verifyAccessToken, checkPermission("manage all"), validate(confirmEventsValidation.confirmEvent), confirmEventsController.confirmEvent);

router.route('/email/:id')
  .post(verifyAccessToken, checkPermission("manage all"), validate(confirmEventsValidation.sendEmail), confirmEventsController.sendEventConfirmationEmail);
router.route('/send-invoice')
    .post(    verifyAccessToken,
        checkPermission("manage all"),
        validate(confirmEventsValidation.sendEmail),
        confirmEventsController.sendInvoice
    )


export default router;
