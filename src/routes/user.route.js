import express from "express";
import { imageUpload } from "../utils/multerConfig.js";
import tokenController from "../controllers/tokenController.js";
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
    checkPermission("manage all"),
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
    validate(userValidation.deleteManyUsers),
    checkPermission("manage all"),
    userController.deleteManyUsers,
  );
router
  .route("/forgot")
  .post(
    validate(userValidation.forgotPassword),
    userController.forgotPassword,
  );
router
  .route("/verify")
  .post(validate(userValidation.verifyEmail), userController.verifyEmail);
router.route("/roles").get(verifyAccessToken, userController.listRoles);
router.route("/refresh").post(tokenController.refreshToken);
router.route("/signout").post(tokenController.signOut);

router
  .route("/:id")
  .get(
    validate(userValidation.getUser),
    verifyAccessToken,
    checkPermission("manage all"),
    userController.getUser,
  )
  .put(
    verifyAccessToken,
    upload.single("profile_photo"),
    validate(userValidation.updateUser),
    allowOwnerOr("manage all"),
    userController.updateUser,
  )
  .delete(
    verifyAccessToken,
    validate(userValidation.getUser),
    checkPermission("manage all"),
    userController.deleteUser,
  );

export default router;
