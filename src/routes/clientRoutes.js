import express from 'express';
import { verifyAccessToken } from '../middleware/auth0.js';
import { checkPermission } from '../middleware/authorize.js';
import clientController from '../controllers/clientController.js';

const router = express.Router();

// router.use(verifyAccessToken);
const protectAdmin = [verifyAccessToken, checkPermission('manage all')];


router.get('/', protectAdmin, clientController.listClients);
router.get('/:id', protectAdmin, clientController.getClient);
router.post('/', protectAdmin, clientController.createClient);
router.put('/:id', protectAdmin, clientController.updateClient);
router.delete('/:id', protectAdmin, clientController.deleteClient);
router.post('/delete-many', protectAdmin, clientController.deleteManyClients);

export default router;
