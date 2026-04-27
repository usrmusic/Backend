import express from "express";
import { dashboardController } from "../controllers/index.js";
import { verifyAccessToken } from "../middleware/auth0.js";
import { checkPermission } from "../middleware/authorize.js";
import validate from "../middleware/validate.js";
import { dashboardValidation } from "../validation/index.js";

const router = express.Router();

const protectAdmin = [verifyAccessToken, checkPermission("manage all")];

router
  .route("/")
  .get(
    protectAdmin,
    validate(dashboardValidation.getDashboardStats),
    dashboardController.getDashboardStats,
  );

router
  .route("/upcoming-events")
  .get(protectAdmin, validate(dashboardValidation.getUpcomingEvents), dashboardController.getUpcomingEvents);

router
  .route("/drop-down")
  .get(
    protectAdmin,
    validate(dashboardValidation.getEventsDropDown),
    dashboardController.getEventsDropDown,
  );

router
  .route("/recalculate-profits")
  .post(protectAdmin, dashboardController.recalculateProfits);

export default router;
