import express from 'express';
import { verifyAccessToken } from '../middleware/auth0.js';
import { checkPermission } from '../middleware/authorize.js';
import contractController from '../controllers/contractController.js';

const router = express.Router();
const protectAdmin = [verifyAccessToken, checkPermission('manage all')];

router.get('/', protectAdmin, contractController.listContracts);
router.get('/:id', protectAdmin, contractController.getContract);
router.post('/', protectAdmin, contractController.createContract);
router.put('/:id', protectAdmin, contractController.updateContract);
router.delete('/:id', protectAdmin, contractController.deleteContract);

export default router;
