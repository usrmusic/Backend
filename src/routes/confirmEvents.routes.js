import express from "express";
import { verifyAccessToken } from "../middleware/auth0.js";
import validate from "../middleware/validate.js";
import { checkPermission } from "../middleware/authorize.js";
import { confirmEventsController } from "../controllers/index.js";
import { confirmEventsValidation } from "../validation/index.js";

const router = express.Router();

// confirm event -> "confirm event"; completed event view -> "complete event"
// (mirrors Laravel routes/web.php groups)

router
  .route("/")
  .get(
    verifyAccessToken,
    checkPermission("confirm event"),
    validate(confirmEventsValidation.listConfirmEvents),
    confirmEventsController.listConfirmEvents,
  );

router
  .route("/completed")
  .get(
    verifyAccessToken,
    checkPermission("complete event"),
    validate(confirmEventsValidation.listConfirmEvents),
    confirmEventsController.listCompletedConfirmEvents,
  );

router
  .route("/send-invoice")
  .post(
    verifyAccessToken,
    checkPermission("confirm event"),
    validate(confirmEventsValidation.sendEmail),
    confirmEventsController.sendInvoice,
  );

router
  .route("/download-invoice/:id")
  .post(
    verifyAccessToken,
    checkPermission("confirm event"),
    validate(confirmEventsValidation.downloadInvoice),
    confirmEventsController.downloadInvoice,
  );

router
  .route("/refund")
  .post(
    verifyAccessToken,
    checkPermission("confirm event"),
    validate(confirmEventsValidation.refund),
    confirmEventsController.refund,
  );

router
  .route("/cancel")
  .post(
    verifyAccessToken,
    checkPermission("confirm event"),
    validate(confirmEventsValidation.cancel),
    confirmEventsController.cancelEvent,
  );

router
  .route("/payment")
  .post(
    verifyAccessToken,
    checkPermission("confirm event"),
    validate(confirmEventsValidation.addPayment),
    confirmEventsController.addPayment,
  );

router
  .route("/:id")
  .get(
    // allow authenticated users to fetch a confirmed event; controller enforces
    // fine-grained authorization so staff with view_confirmed_events can access.
    verifyAccessToken,
    validate(confirmEventsValidation.getConfirmEvent),
    confirmEventsController.getConfirmEvent,
  )
  .post(
    verifyAccessToken,
    checkPermission("confirm event"),
    validate(confirmEventsValidation.confirmEvent),
    confirmEventsController.confirmEvent,
  )
  .put(
    verifyAccessToken,
    checkPermission("confirm event"),
    validate(confirmEventsValidation.updateEvent),
    confirmEventsController.updateEvent,
  );

router
  .route("/email/:id")
  .post(
    verifyAccessToken,
    checkPermission("confirm event"),
    validate(confirmEventsValidation.sendEmail),
    confirmEventsController.sendEventConfirmationEmail,
  );

export default router;
