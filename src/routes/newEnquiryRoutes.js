import express from 'express';
import { verifyAccessToken } from '../middleware/auth0.js';
import { checkPermission } from '../middleware/authorize.js';
import newEnquiryCtrl from '../controllers/newEnquiryController.js';

const router = express.Router();
const protectAdmin = [verifyAccessToken, checkPermission('manage all')];



export default router;
