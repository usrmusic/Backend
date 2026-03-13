import express from "express";
import { verifyAccessToken } from "../middleware/auth0.js";
import { checkPermission } from "../middleware/authorize.js";
import { reportsController } from "../controllers/index.js";
import { reportsValidation } from "../validation/index.js";
import validate from "../middleware/validate.js";

const router = express.Router();
const protectAdmin = [verifyAccessToken, checkPermission("manage all")];

router
  .route("/suppliers")
  .get(
    protectAdmin,
    validate(reportsValidation.suppliersReport),
    reportsController.suppliersReport,
  );

router
  .route("/admin")
  .get(
    protectAdmin,
    validate(reportsValidation.adminReport),
    reportsController.adminReport,
  );

export default router;
