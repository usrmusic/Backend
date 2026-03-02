import express from 'express';
import { verifyAccessToken } from '../middleware/auth0.js';
import { checkPermission } from '../middleware/authorize.js';
import packageTypeController from '../controllers/packageTypeController.js';
import packageUserController from '../controllers/packageUserController.js';
import pueController from '../controllers/packageUserEquipmentController.js';
import eventPackageController from '../controllers/eventPackageController.js';

const router = express.Router();
const protectAdmin = [verifyAccessToken, checkPermission('manage all')];


router.route('/types')
	.get(protectAdmin, packageTypeController.listPackageTypes)
	.post(protectAdmin, packageTypeController.createPackageType);
router.route('/types/:id')
	.get(protectAdmin, packageTypeController.getPackageType)
	.put(protectAdmin, packageTypeController.updatePackageType)
	.delete(protectAdmin, packageTypeController.deletePackageType);
router.route('/users')
    .get(protectAdmin, packageUserController.listPackageUsers)
    .post(protectAdmin, packageUserController.createPackageUser);
router.route('/users/:id')
    .get(protectAdmin, packageUserController.getPackageUser)
    .put(protectAdmin, packageUserController.updatePackageUser)
    .delete(protectAdmin, packageUserController.deletePackageUser);
router.route('/users-equipment')
    .get(protectAdmin, pueController.listPackageUserEquipment)
router.route('/users-equipment/:package_user_id/equipment/:equipment_id')
    .get(protectAdmin, pueController.getPackageUserEquipment)
    .post(protectAdmin, pueController.createPackageUserEquipment)
    .put(protectAdmin, pueController.updatePackageUserEquipment)
    .delete(protectAdmin, pueController.deletePackageUserEquipment);
router.route('/user-event')
    .get(protectAdmin, eventPackageController.listEventPackages)
    .post(protectAdmin, eventPackageController.createEventPackage);
router.route('/user-event/:id')
    .get(protectAdmin, eventPackageController.getEventPackage)
    .put(protectAdmin, eventPackageController.updateEventPackage)
    .delete(protectAdmin, eventPackageController.deleteEventPackage);

export default router;