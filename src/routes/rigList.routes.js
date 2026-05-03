import express from "express";
import { verifyAccessToken } from "../middleware/auth0.js";
import checkPermission from "../middleware/authorize.js";
import validate from "../middleware/validate.js";
import { rigListController } from "../controllers/index.js";
import { rigListValidation } from "../validation/index.js";

const router = express.Router();

const protectAdmin = [verifyAccessToken, checkPermission("rig list")];

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
