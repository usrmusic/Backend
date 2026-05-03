import express from "express";
import { dashboardController } from "../controllers/index.js";
import { verifyAccessToken } from "../middleware/auth0.js";
import { checkPermission } from "../middleware/authorize.js";
import validate from "../middleware/validate.js";
import { dashboardValidation } from "../validation/index.js";

const router = express.Router();

// allow any authenticated user for main dashboard endpoints; keep admin-only for sensitive ops
const authOnly = [verifyAccessToken];
const protectAdmin = [verifyAccessToken, checkPermission("manage_all")];

router
  .route("/")
  .get(
    authOnly,
    validate(dashboardValidation.getDashboardStats),
    dashboardController.getDashboardStats,
  );

router
  .route("/upcoming-events")
  .get(authOnly, validate(dashboardValidation.getUpcomingEvents), dashboardController.getUpcomingEvents);

router
  .route("/drop-down")
  // allow any authenticated user to use the dropdown (used by header search)
  .get(
    authOnly,
    validate(dashboardValidation.getEventsDropDown),
    dashboardController.getEventsDropDown,
  );

router
  .route("/recalculate-profits")
  .post(protectAdmin, dashboardController.recalculateProfits);

export default router;
