import express from 'express';
import enquiryController from '../controllers/enquiryController.js';
import validate, { enquiry } from '../validation/index.js';
import enquirySchema, { openUpdateSchema, openSendSchema, openConfirmSchema } from '../validation/enquiry.validation.js';

const router = express.Router();


router.route('/')
    .get(enquiryController.listEnquiries)
    .post(enquiryController.createEnquiry);
router.route('/open')
    .get(enquiryController.getOpenEnquiry)
    .post(enquiryController.updateOpenEnquiry)
    .delete(enquiryController.deleteOpenEnquiry);
router.route('/open/send-brochure')
    .post(enquiryController.sendUsrBrochure);
router.route('/open/send-update')
    .post(enquiryController.sendUsrUpdateEmail);
router.route('/open/send-quote')
    .post(enquiryController.sendQuote);
router.route('/open/send-invoice')
    .post(enquiryController.sendInvoice);
router.route('/open/confirm')
    .post(enquiryController.addDepositStore);


router.route('/new-enquiry/equipment-availability')
    .get(newEnquiryCtrl.getEquipmentAvailability);
router.route('/new-enquiry/check-quantity')
    .get(newEnquiryCtrl.checkQuantity);
router.route('/new-enquiry/package/:id')
    .get(newEnquiryCtrl.getPackageWithEquipment);


// confirmed events routes (converted to route chaining)
router.route('/')
    .get(verifyAccessToken, confirmedCtrl.getConfirmedEvents);

router.route('/show')
    .get(verifyAccessToken, confirmedCtrl.showEvent);

router.route('/update')
    .post(verifyAccessToken, confirmedCtrl.updateEvent);

router.route('/auto-save/:id')
    .post(verifyAccessToken, confirmedCtrl.confirmedEventAutoSave);

router.route('/event-cancel')
    .post(verifyAccessToken, confirmedCtrl.cancelledEvent);

router.route('/event-refund')
    .post(verifyAccessToken, confirmedCtrl.eventRefund);

router.route('/get-venue-dropdown')
    .get(verifyAccessToken, confirmedCtrl.getVenueDropdown);

router.route('/get-active-dj-names')
    .get(verifyAccessToken, confirmedCtrl.getDjDropdown);

router.route('/get-payment-method')
    .get(verifyAccessToken, confirmedCtrl.getEventPaymentMethods);

router.route('/get-enquiry-with/:eventId')
    .get(verifyAccessToken, confirmedCtrl.getEnquiryWithDetails);

router.route('/get-event-plan-form')
    .get(verifyAccessToken, confirmedCtrl.getEventPlanForm);

router.route('/send-mail')
    .post(verifyAccessToken, confirmedCtrl.sendConfirmedEventMail);

router.route('/send-invoice')
    .post(verifyAccessToken, confirmedCtrl.sendInvoiceMail);

router.route('/send-quote')
    .post(verifyAccessToken, confirmedCtrl.sendQuoteMail);

router.route('/notes')
    .post(verifyAccessToken, confirmedCtrl.confirmedEventNotes);

router.route('/payments')
    .post(verifyAccessToken, confirmedCtrl.confirmedEventPayments);

router.route('/dj-availability')
    .get(verifyAccessToken, confirmedCtrl.djAvailabilityCheck);

    
export default router;
