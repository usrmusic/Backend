import express from 'express';
import { verifyAccessToken } from '../middleware/auth0.js';
import { checkPermission } from '../middleware/authorize.js';
import packageUserController from '../controllers/packageUserController.js';

const router = express.Router();
const protectAdmin = [verifyAccessToken, checkPermission('manage all')];

router.get('/', protectAdmin, packageUserController.listPackageUsers);
router.get('/:id', protectAdmin, packageUserController.getPackageUser);
router.post('/', protectAdmin, packageUserController.createPackageUser);
router.put('/:id', protectAdmin, packageUserController.updatePackageUser);
router.delete('/:id', protectAdmin, packageUserController.deletePackageUser);

export default router;
