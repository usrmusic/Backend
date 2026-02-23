import express from 'express';
import { verifyAccessToken } from '../middleware/auth0.js';
import { checkPermission } from '../middleware/authorize.js';
import packageTypeController from '../controllers/packageTypeController.js';

const router = express.Router();
const protectAdmin = [verifyAccessToken, checkPermission('manage all')];

router.get('/', protectAdmin, packageTypeController.listPackageTypes);
router.get('/:id', protectAdmin, packageTypeController.getPackageType);
router.post('/', protectAdmin, packageTypeController.createPackageType);
router.put('/:id', protectAdmin, packageTypeController.updatePackageType);
router.delete('/:id', protectAdmin, packageTypeController.deletePackageType);

export default router;
