import express from "express";
import { verifyAccessToken } from "../middleware/auth0.js";
import { checkPermission, checkPermissionAny } from "../middleware/authorize.js";
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
// Read-only venue picker used by the Enquiry, Confirmed Events, and Rig List
// forms — same fix as the user dropdown (see user.route.js): gating this by
// "user" (venue-management access) blocked Staff/DJs from ever seeing venue
// names on events they're allowed to edit, since the Select needs this list
// to resolve an id to a label. Gate by the permissions that actually reach
// these forms instead.
router.route("/get-dropdown").get(
  verifyAccessToken,
  checkPermissionAny(["user", "new enquiry", "open enquiry", "confirm event", "rig list"]),
  venueController.listVenueDropdown,
);
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
