import express from 'express';
import confirmedCtrl from '../controllers/confirmedEventsController.js';
import { verifyAccessToken } from '../middleware/auth0.js';

const router = express.Router();

router.get('/', verifyAccessToken, confirmedCtrl.getConfirmedEvents);
router.get('/show', verifyAccessToken, confirmedCtrl.showEvent);
router.post('/send-mail', verifyAccessToken, confirmedCtrl.sendConfirmedEventMail);
router.post('/send-invoice', verifyAccessToken, confirmedCtrl.sendInvoiceMail);
router.post('/send-quote', verifyAccessToken, confirmedCtrl.sendQuoteMail);
router.post('/notes', verifyAccessToken, confirmedCtrl.confirmedEventNotes);
router.post('/payments', verifyAccessToken, confirmedCtrl.confirmedEventPayments);
router.get('/dj-availability', verifyAccessToken, confirmedCtrl.djAvailabilityCheck);

export default router;
