import express from 'express';
import { verifyAccessToken } from '../middleware/auth0.js';
import checkpermission  from '../middleware/authorize.js';
import { calendarController } from '../controllers/index.js';
import { calendarValidation } from '../validation/index.js';
import validate from '../middleware/validate.js';


const checkAdmin = [verifyAccessToken, checkpermission('calendar')]

const router = express.Router();

router.route('/')
    .get(checkAdmin, validate(calendarValidation.getCalenderEvents), calendarController.getCalenderEvents);

export default router;
