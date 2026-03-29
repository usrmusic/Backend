import express from "express";
import { verifyAccessToken } from "../middleware/auth0.js";
import validate from "../middleware/validate.js";
import { checkPermission } from "../middleware/authorize.js";
import { confirmEventsController } from "../controllers/index.js";
import { confirmEventsValidation } from "../validation/index.js";

const router = express.Router();

router
  .route("/")
  .get(
    verifyAccessToken,
    checkPermission("manage all"),
    validate(confirmEventsValidation.listConfirmEvents),
    confirmEventsController.listConfirmEvents,
  );
router
  .route("/completed")
  .get(
    verifyAccessToken,
    checkPermission("manage all"),
    validate(confirmEventsValidation.listConfirmEvents),
    confirmEventsController.listCompletedConfirmEvents,
  );
router
  .route("/send-invoice")
  .post(
    verifyAccessToken,
    checkPermission("manage all"),
    validate(confirmEventsValidation.sendEmail),
    confirmEventsController.sendInvoice,
  );
// Download invoice (parity with Laravel POST /download-invoice)
router
  .route("/download-invoice/:id")
  .post(
    verifyAccessToken,
    checkPermission("manage all"),
    validate(confirmEventsValidation.downloadInvoice),
    confirmEventsController.downloadInvoice,
  );
router
  .route("/refund")
  .post(
    verifyAccessToken,
    checkPermission("manage all"),
    validate(confirmEventsValidation.refund),
    confirmEventsController.refund,
  );
router
  .route("/cancel")
  .post(
    verifyAccessToken,
    checkPermission("manage all"),
    validate(confirmEventsValidation.cancel),
    confirmEventsController.cancelEvent,
  );
router
  .route("/:id")
  .get(
    verifyAccessToken,
    checkPermission("manage all"),
    validate(confirmEventsValidation.getConfirmEvent),
    confirmEventsController.getConfirmEvent,
  )
  .post(
    verifyAccessToken,
    checkPermission("manage all"),
    validate(confirmEventsValidation.confirmEvent),
    confirmEventsController.confirmEvent,
  )
  .put(
    verifyAccessToken,
    checkPermission("manage all"),
    validate(confirmEventsValidation.updateEvent),
    confirmEventsController.updateEvent
  )
router
  .route("/email/:id")
  .post(
    verifyAccessToken,
    checkPermission("manage all"),
    validate(confirmEventsValidation.sendEmail),
    confirmEventsController.sendEventConfirmationEmail,
  );

export default router;
