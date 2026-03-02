import express from "express";
import { verifyAccessToken } from "../middleware/auth0.js";
import { checkPermission } from "../middleware/authorize.js";
import {venueController} from "../controllers/index.js";
import validate from "../middleware/validate.js";
import { venueValidation } from "../validation/index.js";
import multer from 'multer';
const upload = multer();

const router = express.Router();

// Protect with admin-level permission by default
const protectAdmin = [verifyAccessToken, checkPermission("manage all")];

router
  .route("/")
  .get(
    protectAdmin,
    validate(venueValidation.listVenues),
    venueController.listVenues,
  )
  .post(
    upload.single('attachment'),
    validate(venueValidation.createVenue),
    protectAdmin,
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
    upload.single('attachment'),
    validate(venueValidation.updateVenue),
    protectAdmin,
    venueController.updateVenue,
  )
  .delete(
    protectAdmin,
    validate(venueValidation.deleteVenue),
    venueController.deleteVenue,
  );

export default router;
