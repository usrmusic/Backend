import express from "express";
import { verifyAccessToken } from "../middleware/auth0.js";
import { checkPermission } from "../middleware/authorize.js";
import { reportsController } from "../controllers/index.js";
import { reportsValidation } from "../validation/index.js";
import validate from "../middleware/validate.js";

const router = express.Router();

router
  .route("/suppliers")
  .get(
    verifyAccessToken,
    checkPermission("supplier reporting"),
    validate(reportsValidation.suppliersReport),
    reportsController.suppliersReport,
  );

router
  .route("/admin")
  .get(
    verifyAccessToken,
    checkPermission("admin reporting"),
    validate(reportsValidation.adminReport),
    reportsController.adminReport,
  );

export default router;
