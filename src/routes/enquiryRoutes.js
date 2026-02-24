import express from 'express';
import enquiryController from '../controllers/enquiryController.js';

const router = express.Router();

// create enquiry
router.post('/', enquiryController.createEnquiry);

export default router;
