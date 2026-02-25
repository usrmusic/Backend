import express from 'express';
import { verifyAccessToken } from '../middleware/auth0.js';
import { checkPermission } from '../middleware/authorize.js';
import paymentMethodController from '../controllers/paymentMethodController.js';

const router = express.Router();
const protectAdmin = [verifyAccessToken, checkPermission('manage all')];

router.get('/', protectAdmin, paymentMethodController.listPaymentMethods);
router.get('/:id', protectAdmin, paymentMethodController.getPaymentMethod);
router.post('/', protectAdmin, paymentMethodController.createPaymentMethod);
router.put('/:id', protectAdmin, paymentMethodController.updatePaymentMethod);
router.delete('/:id', protectAdmin, paymentMethodController.deletePaymentMethod);

export default router;
