import express from "express";
import { enquiryController } from "../controllers/index.js";
import { enquiryValidation } from "../validation/index.js";
import validate from "../middleware/validate.js";
import { verifyAccessToken } from "../middleware/auth0.js";
import { checkPermission } from "../middleware/authorize.js";

const router = express.Router();

// Listing/searching open enquiries -> "open enquiry"
// Creating a new enquiry / quote / brochure -> "new enquiry"
// (mirrors Laravel routes/web.php groups for new vs open enquiry)

router
  .route("/")
  .get(
    verifyAccessToken,
    checkPermission("open enquiry"),
    validate(enquiryValidation.listOpenEnquiries),
    enquiryController.listOpenEnquiries,
  )
  .post(
    verifyAccessToken,
    checkPermission("new enquiry"),
    validate(enquiryValidation.createEnquiry),
    enquiryController.createEnquiry,
  );

router
  .route("/add-note/:id")
  .post(
    verifyAccessToken,
    checkPermission("open enquiry"),
    validate(enquiryValidation.addNote),
    enquiryController.addNote,
  );

router
  .route("/staff-equipment")
  .get(
    verifyAccessToken,
    checkPermission("new enquiry"),
    validate(enquiryValidation.staffEquipment),
    enquiryController.staffEquipment,
  );

router
  .route("/get-email")
  .get(
    verifyAccessToken,
    checkPermission("open enquiry"),
    validate(enquiryValidation.getEmail),
    enquiryController.getEmail,
  );

router
  .route("/brochure")
  .post(
    verifyAccessToken,
    checkPermission("open enquiry"),
    validate(enquiryValidation.sendEmail),
    enquiryController.sendBrochure,
  );

router
  .route("/email-update")
  .post(
    verifyAccessToken,
    checkPermission("open enquiry"),
    validate(enquiryValidation.sendEmail),
    enquiryController.sendUpdateEmail,
  );

router
  .route("/quote")
  .post(
    verifyAccessToken,
    checkPermission("open enquiry"),
    validate(enquiryValidation.sendEmail),
    enquiryController.sendQuote,
  );

router
  .route("/:id")
  .get(
    verifyAccessToken,
    checkPermission("open enquiry"),
    validate(enquiryValidation.getEnquiry),
    enquiryController.getEnquiryWithDetails,
  )
  .put(
    verifyAccessToken,
    checkPermission("open enquiry"),
    validate(enquiryValidation.updateEnquiry),
    enquiryController.updateEnquiry,
  )
  .delete(
    verifyAccessToken,
    checkPermission("open enquiry"),
    validate(enquiryValidation.deleteEnquiry),
    enquiryController.deleteEnquiry,
  );

router.route("/delete-many/:ids").delete(
  verifyAccessToken,
  checkPermission("open enquiry"),
  validate(enquiryValidation.deleteManyEnquiries),
  enquiryController.deleteManyEnquiries,
);

export default router;
