import express from "express";
import { verifyAccessToken } from "../middleware/auth0.js";
import validate from "../middleware/validate.js";
import { checkPermission, requireAdmin, blockClient } from "../middleware/authorize.js";
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
  .route("/events-dropdown")
  .get(verifyAccessToken, checkPermission("confirm event"), confirmEventsController.listEventsDropdown);

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
    // Send Invoice never appears on the Client's confirmed-events toolbar in
    // the legacy Laravel CRM (confirmed_events_client.blade.php's button set
    // is Modify/Update/Print/Download Invoice only).
    verifyAccessToken,
    checkPermission("confirm event"),
    blockClient,
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
    // Refund is Admin/Super Admin only, matching the legacy Laravel CRM
    // (confirmed_events.blade.php's Refund button only ever renders inside
    // the @hasrole('Super Admin|Admin') branch — Staff and Client never get it).
    verifyAccessToken,
    requireAdmin,
    validate(confirmEventsValidation.refund),
    confirmEventsController.refund,
  );

router
  .route("/cancel")
  .post(
    // Cancel Event never appears on the Client's confirmed-events toolbar in
    // the legacy Laravel CRM (same button set as Send Invoice above).
    verifyAccessToken,
    checkPermission("confirm event"),
    blockClient,
    validate(confirmEventsValidation.cancel),
    confirmEventsController.cancelEvent,
  );

router
  .route("/payment")
  .post(
    // Add Payment is Admin/Super Admin only, matching the legacy Laravel CRM
    // (sidebar_ui_new.blade.php's Add Payment form only renders for
    // @hasrole('Super Admin|Admin') — Staff and Client never get it).
    verifyAccessToken,
    requireAdmin,
    validate(confirmEventsValidation.addPayment),
    confirmEventsController.addPayment,
  );

// Edit/delete of an existing payment row — same Admin-only gate as adding
// one, since both mutate the same paid-total/outstanding calculations.
router
  .route("/payment/:id")
  .put(
    verifyAccessToken,
    requireAdmin,
    validate(confirmEventsValidation.updatePayment),
    confirmEventsController.updatePayment,
  )
  .delete(
    verifyAccessToken,
    requireAdmin,
    validate(confirmEventsValidation.deletePayment),
    confirmEventsController.deletePayment,
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
    // Confirming an enquiry (turning it into a confirmed event via a deposit)
    // is Admin/Super Admin only, matching Laravel's Deposit form
    // (@hasrole('Super Admin|Admin')) — Staff never gets this action.
    verifyAccessToken,
    requireAdmin,
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
