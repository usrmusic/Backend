import express from 'express';
import { verifyAccessToken } from '../middleware/auth0.js';
import { checkPermission } from '../middleware/authorize.js';
import equipmentController from '../controllers/equipmentController.js';

const router = express.Router();
const protectAdmin = [verifyAccessToken, checkPermission('manage all')];

router.get('/', protectAdmin, equipmentController.listEquipment);
router.get('/:id', protectAdmin, equipmentController.getEquipment);
router.post('/', protectAdmin, equipmentController.createEquipment);
router.put('/:id', protectAdmin, equipmentController.updateEquipment);
router.delete('/:id', protectAdmin, equipmentController.deleteEquipment);

export default router;
