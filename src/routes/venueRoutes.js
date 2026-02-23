import express from 'express';
import { verifyAccessToken } from '../middleware/auth0.js';
import { checkPermission } from '../middleware/authorize.js';
import venueController from '../controllers/venueController.js';

const router = express.Router();

// Protect with admin-level permission by default
const protectAdmin = [verifyAccessToken, checkPermission('manage all')];

router.get('/', protectAdmin, venueController.listVenues);
router.get('/:id', protectAdmin, venueController.getVenue);
router.post('/', protectAdmin, venueController.createVenue);
router.put('/:id', protectAdmin, venueController.updateVenue);
router.delete('/:id', protectAdmin, venueController.deleteVenue);

export default router;
