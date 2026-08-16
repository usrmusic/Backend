import express from "express";
import { verifyAccessToken } from "../middleware/auth0.js";
import { checkPermission } from "../middleware/authorize.js";
import {venueController} from "../controllers/index.js";
import validate from "../middleware/validate.js";
import { venueValidation } from "../validation/index.js";
// Hardened upload (size limit + mime filter) — venue attachments may be images
// or documents, so use the broad fileUpload config rather than a bare multer().
import { fileUpload as upload } from "../utils/multerConfig.js";

const router = express.Router();

// Protect with admin-level permission by default
const protectAdmin = [verifyAccessToken, checkPermission("user")];

router
  .route("/")
  .get(
    protectAdmin,
    validate(venueValidation.listVenues),
    venueController.listVenues,
  )
  .post(
    protectAdmin,
    upload.single('attachment'),
    validate(venueValidation.createVenue),
    venueController.createVenue,
  );
router
  .route("/delete-many")
  .post(
    protectAdmin,
    validate(venueValidation.deleteManyVenues),
    venueController.deleteManyVenues,
  );
router.route("/get-dropdown").get(protectAdmin, venueController.listVenueDropdown);
router
  .route("/:id")
  .get(
    protectAdmin,
    validate(venueValidation.getVenue),
    venueController.getVenue,
  )
  .put(
    protectAdmin,
    upload.single('attachment'),
    validate(venueValidation.updateVenue),
    venueController.updateVenue,
  )
  .delete(
    protectAdmin,
    validate(venueValidation.deleteVenue),
    venueController.deleteVenue,
  );

export default router;
