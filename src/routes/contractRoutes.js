import express from 'express';
import { verifyAccessToken } from '../middleware/auth0.js';
import { checkPermission } from '../middleware/authorize.js';
import contractController from '../controllers/contractController.js';

const router = express.Router();
const protectAdmin = [verifyAccessToken, checkPermission('manage all')];

router.get('/', protectAdmin, contractController.listContracts);
router.get('/:id', protectAdmin, contractController.getContract);
// Download signed PDF (authenticated users)
router.get('/:id/download', verifyAccessToken, contractController.downloadContract);
// Generate unsigned contract PDF (admin)
router.post('/:id/generate', protectAdmin, contractController.generateContractPdf);
// Sign contract (authenticated user) - embed signature and save signed PDF
router.post('/:id/sign', verifyAccessToken, contractController.signContract);
router.post('/', protectAdmin, contractController.createContract);
router.put('/:id', protectAdmin, contractController.updateContract);
router.delete('/:id', protectAdmin, contractController.deleteContract);

export default router;
