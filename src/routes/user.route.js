import express from "express";
import { imageUpload } from "../utils/multerConfig.js";
import {tokenController} from "../controllers/index.js";
import { allowOwnerOr } from "../middleware/authorize.js";
const upload = imageUpload;
import { verifyAccessToken } from "../middleware/auth0.js";
import checkPermission from "../middleware/authorize.js";
import { userValidation } from "../validation/index.js";
import { userController } from "../controllers/index.js";
import validate from "../middleware/validate.js";

const router = express.Router();

router;

router
  .route("/auth")
  .post(validate(userValidation.signIn), userController.signIn);

router
  .route("/")
  .get(
    verifyAccessToken,
    // If no query params present, return the current authenticated user profile.
    async (req, res, next) => {
      try {
        if (!req.query || Object.keys(req.query).length === 0) {
          return userController.currentUser(req, res);
        }
        return next();
      } catch (e) {
        return next(e);
      }
    },
    checkPermission("user"),
    validate(userValidation.listUsers),
    userController.listUsers,
  )
  .post(
    verifyAccessToken,
    upload.single("profile_photo"),
    validate(userValidation.createUser),
    userController.signUp,
  );
router
  .route("/delete-many")
  .post(
    verifyAccessToken,
    checkPermission("user"),
    validate(userValidation.deleteManyUsers),
    userController.deleteManyUsers,
  );
router
  .route("/get-dropdown")
  .get(
    verifyAccessToken,
    checkPermission("user"),
    userController.listUserDropdown,
  );
router
  .route("/forgot")
  .post(validate(userValidation.forgotPassword), userController.forgotPassword);
router
  .route("/verify")
  .post(validate(userValidation.verifyEmail), userController.verifyEmail);
router
  .route("/verify/request")
  .post(verifyAccessToken, userController.requestVerifyEmail);
router.route("/roles").get(verifyAccessToken, userController.listRoles);
router.route("/refresh").post(tokenController.refreshToken);
router.route("/signout").post(tokenController.signOut);

router
  .route("/:id/reset-password")
  .post(
    verifyAccessToken,
    checkPermission("user"),
    userController.resetPassword,
  );

router
  .route("/:id")
  .get(
    validate(userValidation.getUser),
    verifyAccessToken,
    checkPermission("user"),
    userController.getUser,
  )
  .put(
    verifyAccessToken,
    upload.single("profile_photo"),
    validate(userValidation.updateUser),
    allowOwnerOr("user"),
    userController.updateUser,
  )
  .delete(
    verifyAccessToken,
    validate(userValidation.getUser),
    checkPermission("user"),
    userController.deleteUser,
  );

export default router;
