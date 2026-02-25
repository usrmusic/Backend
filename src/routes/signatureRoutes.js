import express from 'express';
import { verifyAccessToken } from '../middleware/auth0.js';
import { checkPermission } from '../middleware/authorize.js';
import signatureController from '../controllers/signatureController.js';
import { imageUpload } from '../utils/multerConfig.js';

const router = express.Router();
const protectAdmin = [verifyAccessToken, checkPermission('manage all')];
const protectAuth = [verifyAccessToken];

// listing and administrative access
router.get('/', protectAdmin, signatureController.listSignatures);
router.get('/:id', protectAdmin, signatureController.getSignature);

// signing endpoint - authenticated users
router.post('/', protectAuth, imageUpload.single('signature_file'), signatureController.createSignature);

// delete by admin
router.delete('/:id', protectAdmin, signatureController.deleteSignature);

export default router;
