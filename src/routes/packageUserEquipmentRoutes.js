import express from 'express';
import { verifyAccessToken } from '../middleware/auth0.js';
import { checkPermission } from '../middleware/authorize.js';
import pueController from '../controllers/packageUserEquipmentController.js';

const router = express.Router();
const protectAdmin = [verifyAccessToken, checkPermission('manage all')];

// GET /packages/users/equipment?package_user_id=123
router.get('/', protectAdmin, pueController.listPackageUserEquipment);

// GET /packages/users/equipment/:package_user_id/:equipment_id
router.get('/:package_user_id/:equipment_id', protectAdmin, pueController.getPackageUserEquipment);

router.post('/', protectAdmin, pueController.createPackageUserEquipment);
router.put('/:package_user_id/:equipment_id', protectAdmin, pueController.updatePackageUserEquipment);
router.delete('/:package_user_id/:equipment_id', protectAdmin, pueController.deletePackageUserEquipment);

export default router;
