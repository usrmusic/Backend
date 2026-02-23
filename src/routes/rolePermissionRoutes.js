import express from 'express';
import { verifyAccessToken } from '../middleware/auth0.js';
import checkPermission from '../middleware/authorize.js';
import controller from '../controllers/rolePermissionController.js';
import catchAsync from '../utils/catchAsync.js';

const router = express.Router();

// All admin routes require auth + manage access permission
const protectAdmin = [verifyAccessToken, checkPermission('manage all')];

router.get('/manage-access', protectAdmin, catchAsync(controller.index));

// Role CRUD
router.post('/roles', protectAdmin, catchAsync(controller.storeRole));
router.put('/roles/:role', protectAdmin, catchAsync(controller.updateRole));
router.delete('/roles/:role', protectAdmin, catchAsync(controller.destroyRole));

// Permission CRUD
router.post('/permissions', protectAdmin, catchAsync(controller.storePermission));
router.put('/permissions/:permission', protectAdmin, catchAsync(controller.updatePermission));
router.delete('/permissions/:permission', protectAdmin, catchAsync(controller.destroyPermission));

// Assign permissions to role
router.post('/role-permission/assign', protectAdmin, catchAsync(controller.assignPermissions));
router.get('/role-permission/:role/permissions', protectAdmin, catchAsync(controller.getRolePermissions));

export default router;
