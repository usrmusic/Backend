import express from 'express';
import { verifyAccessToken } from '../middleware/auth0.js';
import pdfCtrl from '../controllers/pdfController.js';

const router = express.Router();

// Generate invoice PDF and store
router.post('/invoice/:eventId/generate', verifyAccessToken, pdfCtrl.generateInvoicePdf);
// Generate rich invoice PDF (better layout)
router.post('/invoice/:eventId/generate-rich', verifyAccessToken, pdfCtrl.generateRichInvoicePdf);
// Get download URL for latest invoice for event
router.get('/invoice/:eventId/download', verifyAccessToken, pdfCtrl.downloadInvoice);

export default router;
