import express from 'express';
import { verifyAccessToken } from '../middleware/auth0.js';
import { checkPermission } from '../middleware/authorize.js';
import eventNoteController from '../controllers/eventNoteController.js';

const router = express.Router();
const protectAdmin = [verifyAccessToken, checkPermission('manage all')];

router.get('/', protectAdmin, eventNoteController.listEventNotes);
router.get('/:id', protectAdmin, eventNoteController.getEventNote);
router.post('/', protectAdmin, eventNoteController.createEventNote);
router.put('/:id', protectAdmin, eventNoteController.updateEventNote);
router.delete('/:id', protectAdmin, eventNoteController.deleteEventNote);

export default router;
