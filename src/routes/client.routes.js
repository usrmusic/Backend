import express from "express";
import { verifyAccessToken } from "../middleware/auth0.js";
import { checkPermission } from "../middleware/authorize.js";
import {clientController} from "../controllers/index.js";
import { clientValidation } from "../validation/index.js";
import validate from "../middleware/validate.js";
// Hardened upload (size limit + mime filter) instead of a bare multer() with no
// limits/filter, which let an UNAUTHENTICATED caller buffer arbitrary bytes.
import { imageUpload as upload } from "../utils/multerConfig.js";
const router = express.Router();

// router.use(verifyAccessToken);
const protectAdmin = [verifyAccessToken, checkPermission("user")];

router
  .route("/")
  .get(protectAdmin, validate(clientValidation.listClients), clientController.listClients)
  // Auth FIRST — previously multer + validate ran before the auth check, so an
  // anonymous caller could trigger file parsing and leak schema via 400s.
  .post(
    protectAdmin,
    upload.single('profile_photo'),
    validate(clientValidation.createClient),
    clientController.createClient,
  );
router
  .route("/delete-many")
  .post(protectAdmin, validate(clientValidation.deleteManyClients), clientController.deleteManyClients);
router
  .route("/get-dropdown")
  .get(
    protectAdmin,
    validate(clientValidation.getClient),
    clientController.listclientdropdown,
  );
router
  .route("/:id")
  .get(protectAdmin, clientController.getClient)
  .put(
    protectAdmin,
    upload.single('profile_photo'),
    validate(clientValidation.updateClient),
    clientController.updateClient,
  )
  .delete(
    protectAdmin,
    validate(clientValidation.deleteClient),
    clientController.deleteClient,
  );

export default router;
