import express from 'express';
import { verifyAccessToken } from '../middleware/auth0.js';
import { checkPermission } from '../middleware/authorize.js';
import reportsCtrl from '../controllers/reportsController.js';

const router = express.Router();
const protectAdmin = [verifyAccessToken, checkPermission('manage all')];

router.get('/admin', protectAdmin, reportsCtrl.adminReport);
router.get('/suppliers', protectAdmin, reportsCtrl.suppliersReport);
router.get('/completed', protectAdmin, reportsCtrl.completedEventsReport);
router.get('/cancelled', protectAdmin, reportsCtrl.cancelledEventsReport);
router.get('/export', protectAdmin, reportsCtrl.exportReport);

export default router;
