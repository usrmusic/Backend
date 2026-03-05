import express from "express";
import { emailContentController } from "../controllers/index.js";
import { emailContentValidation } from "../validation/index.js";
import validate from "../middleware/validate.js";
import checkPermission from "../middleware/authorize.js";
import { verifyAccessToken } from "../middleware/auth0.js";
const router = express.Router();

const protectAdmin = [verifyAccessToken, checkPermission("manage all")];

router
  .route("/")
  .get(
    protectAdmin,
    validate(emailContentValidation.listEmailContent),
    emailContentController.listEmailContent,
  );

router
  .route("/:id")
  .post(
    protectAdmin,
    validate(emailContentValidation.updateEmailContent),
    emailContentController.updateEmailContent,
  )
  .get(
    protectAdmin,
    validate(emailContentValidation.getEmailData),
    emailContentController.getEmailData,
  );

export default router;
