import express from 'express';
import { verifyAccessToken } from '../middleware/auth0.js';
import { checkPermission } from '../middleware/authorize.js';
import supplierController from '../controllers/supplierController.js';

const router = express.Router();

const protectAdmin = [verifyAccessToken, checkPermission('manage all')];

router.get('/', protectAdmin, supplierController.listSuppliers);
router.get('/:id', protectAdmin, supplierController.getSupplier);
router.post('/', protectAdmin, supplierController.createSupplier);
router.put('/:id', protectAdmin, supplierController.updateSupplier);
router.delete('/:id', protectAdmin, supplierController.deleteSupplier);

export default router;
