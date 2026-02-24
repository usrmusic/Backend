import express from 'express';
import { verifyAccessToken } from '../middleware/auth0.js';
import { checkPermission } from '../middleware/authorize.js';
import eventPaymentController from '../controllers/eventPaymentController.js';

const router = express.Router();
const protectAdmin = [verifyAccessToken, checkPermission('manage all')];

// GET /payments/event?event_id=123
router.get('/', protectAdmin, eventPaymentController.listEventPayments);
router.get('/:id', protectAdmin, eventPaymentController.getEventPayment);
router.post('/', protectAdmin, eventPaymentController.createEventPayment);
router.put('/:id', protectAdmin, eventPaymentController.updateEventPayment);
router.delete('/:id', protectAdmin, eventPaymentController.deleteEventPayment);

export default router;
