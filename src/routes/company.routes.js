import express from "express";
import { companyController } from "../controllers/index.js";
import { createUploadMiddleware } from "../utils/multerConfig.js";
import { verifyAccessToken } from "../middleware/auth0.js";
import { checkPermission } from "../middleware/authorize.js";
import validate from "../middleware/validate.js";
import { companyValidation } from "../validation/index.js";

const upload = createUploadMiddleware({
  allowedMimeTypes: [
    "image/jpeg",
    "image/png",
    "image/gif",
    "image/webp",
    "image/svg+xml",
    "application/pdf",
    "application/vnd.oasis.opendocument.text",
  ],
});

const checkPermissions = [verifyAccessToken, checkPermission("manage all")];

const router = express.Router();

router
  .route("/")
  .get(
    checkPermissions,
    validate(companyValidation.listCompanies),
    companyController.listCompanies,
  )
  .post(
    checkPermissions,
    upload.fields([
      { name: "company_logo", maxCount: 1 },
      { name: "brochure", maxCount: 1 },
      { name: "admin_signature", maxCount: 1 },
    ]),
    validate(companyValidation.createCompany),
    companyController.createCompany,
  );

router.route('/:id')
  .get(
    checkPermissions,
    validate(companyValidation.getCompany),
    companyController.getCompany,
  )
  .put(
    checkPermissions,
    upload.fields([
      { name: "company_logo", maxCount: 1 },
      { name: "brochure", maxCount: 1 },
      { name: "admin_signature", maxCount: 1 },
    ]),
    validate(companyValidation.updateCompany),
    companyController.updateCompany,
  )
  .delete(
    checkPermissions,
    validate(companyValidation.deleteCompany),
    companyController.deleteCompany,
  );

router.route("/delete-many/:ids").delete(
  checkPermissions,
  validate(companyValidation.deleteCompanies),
  companyController.deleteCompanies,
);

export default router;
