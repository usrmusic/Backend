import express from 'express';
import { verifyAccessToken } from '../middleware/auth0.js';
import checkPermission from '../middleware/authorize.js';
import controller from '../controllers/rigListController.js';

const router = express.Router();

// GET /rig-list
router.get('/rig-list', verifyAccessToken, checkPermission('rig list'), controller.rigListEvent);

// GET /get-event-rig-list?event_id=123
router.get('/get-event-rig-list', verifyAccessToken, checkPermission('rig list'), controller.getEvent);

// POST /rig-list-add-event-notes
router.post('/rig-list-add-event-notes', verifyAccessToken, checkPermission('rig list'), controller.StoreRigListNotes);

export default router;
