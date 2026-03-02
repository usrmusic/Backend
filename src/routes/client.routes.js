import express from "express";
import { verifyAccessToken } from "../middleware/auth0.js";
import { checkPermission } from "../middleware/authorize.js";
import {clientController} from "../controllers/index.js";
import { clientValidation } from "../validation/index.js";
import validate from "../middleware/validate.js";
import multer from 'multer';
const upload = multer();
const router = express.Router();

// router.use(verifyAccessToken);
const protectAdmin = [verifyAccessToken, checkPermission("manage all")];

router
  .route("/")
  .get(validate(clientValidation.listClients), protectAdmin, clientController.listClients)
  .post(
    upload.single('profile_photo'),
    validate(clientValidation.createClient),
    protectAdmin,
    clientController.createClient,
  );
router
  .route("/delete-many")
  .post(validate(clientValidation.deleteManyClients), protectAdmin, clientController.deleteManyClients);
router
  .route("/get-dropdown")
  .get(
    validate(clientValidation.getClient),
    protectAdmin,
    clientController.listclientdropdown,
  );
router
  .route("/:id")
  .get(protectAdmin, clientController.getClient)
  .put(
    upload.single('profile_photo'),
    validate(clientValidation.updateClient),
    protectAdmin,
    clientController.updateClient,
  )
  .delete(
    validate(clientValidation.deleteClient),
    protectAdmin,
    clientController.deleteClient,
  );

export default router;
