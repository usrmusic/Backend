import express from "express";
import { verifyAccessToken } from "../middleware/auth0.js";
import checkPermission, { blockClient } from "../middleware/authorize.js";
import validate from "../middleware/validate.js";
import { rigListController } from "../controllers/index.js";
import { rigListValidation } from "../validation/index.js";

const router = express.Router();

// Rig list is never a Client-facing feature, even if a Client account is ever
// accidentally granted the "rig list" permission via the manage-access UI —
// matches the legacy Laravel CRM, which hides its rig-list sidebar widget
// specifically for role_id 4 (sidebar_ui_new.blade.php:45) on top of the
// permission gate.
const protectAdmin = [verifyAccessToken, checkPermission("rig list"), blockClient];

router
  .route("/drop-down")
  .get(
    protectAdmin,
    validate(rigListValidation.listEvents),
    rigListController.listEvents,
  );

router
  .route("/:id")
  .get(
    protectAdmin,
    validate(rigListValidation.getEvent),
    rigListController.getEvent,
  )
  .post(
    protectAdmin,
    validate(rigListValidation.storeNotes),
    rigListController.StoreRigListNotes,
  );

export default router;
