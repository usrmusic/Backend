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
  // Brochures are full-colour, multi-page PDFs (the 2026 one is ~18 MB), well
  // past the 10 MB default, which rejected them outright.
  maxBytes: 50 * 1024 * 1024,
});

const checkPermissions = [verifyAccessToken, checkPermission("user")];

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
router.route("/get-dropdown").get(checkPermissions, companyController.listCompanyDropdown);

// Public, deliberately no auth: the permanent "Download Brochure" link in
// emailed brochures (recipients are prospects, not CRM users). Redirects to a
// fresh signed URL on each click, so it never expires like an embedded one.
router.get("/:id/brochure", companyController.downloadBrochure);

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

router.route("/delete-many").post(
  checkPermissions,
  validate(companyValidation.deleteCompanies),
  companyController.deleteCompanies,
);

export default router;
