import express from "express";
import publicEnquiryController from "../controllers/publicEnquiry.controller.js";
import { publicEnquiryValidation } from "../validation/index.js";
import validate from "../middleware/validate.js";
import publicRateLimit from "../middleware/publicRateLimit.js";

const router = express.Router();

// Public, unauthenticated — backs the new website enquiry form (a public
// Next.js page that replaces the old Squarespace iframe target). No JWT, no
// checkPermission: there is no logged-in session on a public lead-capture
// form. Guarded instead by input validation, a honeypot field (checked in
// the controller), and a per-IP rate limit.
router
  .route("/")
  .post(
    publicRateLimit,
    validate(publicEnquiryValidation.createPublicEnquiry),
    publicEnquiryController.createPublicEnquiry,
  );

export default router;
