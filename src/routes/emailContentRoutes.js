import express from 'express';
import emailCtrl from '../controllers/emailContentController.js';

const router = express.Router();

// List email content
router.get('/email-content', emailCtrl.listEmailContent);

// Update (POST to /email-content-update/:id)
router.post('/email-content-update/:id', emailCtrl.updateEmailContent);

// Get email data (dynamic content)
router.get('/get-email-data', emailCtrl.getEmailData);

export default router;
