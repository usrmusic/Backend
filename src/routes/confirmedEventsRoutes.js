import express from 'express';
import confirmedCtrl from '../controllers/confirmedEventsController.js';
import { verifyAccessToken } from '../middleware/auth0.js';

const router = express.Router();



export default router;
