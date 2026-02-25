import express from 'express';
import { verifyAccessToken } from '../middleware/auth0.js';
import { checkPermission } from '../middleware/authorize.js';
import eventPackageController from '../controllers/eventPackageController.js';

const router = express.Router();
const protectAdmin = [verifyAccessToken, checkPermission('manage all')];

router.get('/', protectAdmin, eventPackageController.listEventPackages);
router.get('/:id', protectAdmin, eventPackageController.getEventPackage);
router.post('/', protectAdmin, eventPackageController.createEventPackage);
router.put('/:id', protectAdmin, eventPackageController.updateEventPackage);
router.delete('/:id', protectAdmin, eventPackageController.deleteEventPackage);

export default router;
