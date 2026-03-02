import express from 'express';
import { verifyAccessToken } from '../middleware/auth0.js';
import calendarCtrl from '../controllers/calendarController.js';

const router = express.Router();

router.get('/calendar-events', verifyAccessToken, calendarCtrl.calendarEvents);
router.get('/upcoming-events', verifyAccessToken, calendarCtrl.upcomingEvents);
router.get('/date-events', verifyAccessToken, calendarCtrl.dateEvents);

export default router;
