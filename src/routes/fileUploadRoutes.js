import express from 'express';
import { mediaUpload } from '../utils/multerConfig.js';
import { verifyAccessToken } from '../middleware/auth0.js';
import controller from '../controllers/fileUploadController.js';

const router = express.Router();
const upload = mediaUpload;

// List files (optional ?event_id)
router.get('/', verifyAccessToken, controller.listFiles);

// Upload a file and create DB record
router.post('/', verifyAccessToken, upload.single('file'), controller.storeFile);

// Get metadata + download url
router.get('/:id', verifyAccessToken, controller.getFile);

// Get a presigned download url (or direct download for local)
router.get('/:id/download', verifyAccessToken, controller.downloadFile);

export default router;
