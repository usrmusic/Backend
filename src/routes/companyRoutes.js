import express from 'express';
import companyCtrl from '../controllers/companyController.js';
import { createUploadMiddleware } from '../utils/multerConfig.js';

const upload = createUploadMiddleware({ allowedMimeTypes: [
  'image/jpeg','image/png','image/gif','image/webp','image/svg+xml',
  'application/pdf','application/vnd.oasis.opendocument.text'
] });

const router = express.Router();

// List
router.get('/company-name', companyCtrl.listCompanies);
// Create (multipart: company_logo, brochure)
router.post('/company-name', upload.fields([{ name: 'company_logo', maxCount: 1 }, { name: 'brochure', maxCount: 1 }]), companyCtrl.createCompany);
// Update (frontend uses POST to /company-name-update/:id)
router.post('/company-name-update/:id', upload.fields([{ name: 'company_logo', maxCount: 1 }, { name: 'brochure', maxCount: 1 }]), companyCtrl.updateCompany);
// Delete (frontend calls DELETE /company-name/:ids)
router.delete('/company-name/:ids', companyCtrl.deleteCompanies);

export default router;
