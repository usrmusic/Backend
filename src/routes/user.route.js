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
import rateLimit from "../middleware/rateLimit.js";

const router = express.Router();

router;

// Brute-force protection: 10 login attempts per IP per 15 min. Login accepts a
// legacy plaintext password fallback, so throttling /auth is the main defence
// against credential stuffing. Successful logins count too, but 10/15min is far
// above any human login rate.
const loginLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 10, prefix: "auth" });
// Password reset triggers an email + password change; cap harder per IP. The
// controller additionally rate-limits per target email.
const forgotLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 5, prefix: "forgot" });

router
  .route("/auth")
  .post(loginLimiter, validate(userValidation.signIn), userController.signIn);

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
    // CRITICAL: without this any authenticated user (including a role-4 Client)
    // could create a user with an arbitrary role_id — i.e. mint themselves a
    // Super Admin. Matches the `user` gate on every sibling route in this file.
    // Placed before multer so unauthorized callers don't get their upload parsed.
    checkPermission("user"),
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
// Must stay above `/:id` — otherwise "dj-colors" is swallowed as an id param.
router
  .route("/dj-colors")
  .get(verifyAccessToken, checkPermission("user"), userController.listDjColors);
router
  .route("/forgot")
  .post(forgotLimiter, validate(userValidation.forgotPassword), userController.forgotPassword);
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
