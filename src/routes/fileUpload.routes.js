import express from "express";
import { mediaUpload, fileUpload } from "../utils/multerConfig.js";
import { verifyAccessToken } from "../middleware/auth0.js";
import validate from "../middleware/validate.js";
import { fileUploadController } from "../controllers/index.js";
import { fileUploadValidation } from "../validation/index.js";
import { checkPermission, checkPermissionAny } from "../middleware/authorize.js";

const router = express.Router();
const upload = fileUpload;

// /uploads -> "file upload" ; /media -> "downloads"
// (parity with Laravel can:file upload / can:downloads route groups)

router
  .route("/uploads")
  .get(
    verifyAccessToken,
    checkPermission("file upload"),
    validate(fileUploadValidation.listFiles),
    fileUploadController.listFiles,
  )
  .post(
    verifyAccessToken,
    checkPermission("file upload"),
    upload.single("file"),
    validate(fileUploadValidation.uploadfile),
    fileUploadController.uploadfile,
  );

router
  .route("/media")
  .get(
    verifyAccessToken,
    checkPermissionAny(["downloads", "media manager"]),
    validate(fileUploadValidation.listFiles),
    fileUploadController.listMedia,
  )
  .post(
    verifyAccessToken,
    checkPermissionAny(["downloads", "media manager"]),
    mediaUpload.fields([
      { name: "media", maxCount: 1 },
      { name: "file", maxCount: 1 },
    ]),
    fileUploadController.uploadMedia,
  );

// Self-scoped routes (own event files only) — no "file upload" permission
// required, since Client accounts are never granted it. Must be declared
// before "/uploads/:id" so "mine" isn't captured as an :id param.
router.route("/uploads/mine").get(verifyAccessToken, fileUploadController.listMyFiles);

router
  .route("/uploads/mine/:id/download")
  .get(verifyAccessToken, fileUploadController.downloadMyFile);

router
  .route("/uploads/:id")
  .get(
    verifyAccessToken,
    checkPermission("file upload"),
    validate(fileUploadValidation.getFile),
    fileUploadController.getFile,
  )
  .put(
    verifyAccessToken,
    checkPermission("file upload"),
    validate(fileUploadValidation.updateFileMetadata),
    fileUploadController.updateFileMetadata,
  )
  .delete(
    verifyAccessToken,
    checkPermission("file upload"),
    validate(fileUploadValidation.deleteFile),
    fileUploadController.deleteFile,
  );

router
  .route("/uploads/:id/download")
  .get(
    verifyAccessToken,
    checkPermission("file upload"),
    validate(fileUploadValidation.downloadFile),
    fileUploadController.downloadFile,
  );

router
  .route("/media/:id/")
  .get(
    verifyAccessToken,
    checkPermissionAny(["downloads", "media manager"]),
    validate(fileUploadValidation.downloadFile),
    fileUploadController.downloadMedia,
  )
  .post(
    verifyAccessToken,
    checkPermissionAny(["downloads", "media manager"]),
    mediaUpload.fields([
      { name: "media", maxCount: 1 },
      { name: "file", maxCount: 1 },
    ]),
    fileUploadController.updateMedia,
  )
  .delete(
    verifyAccessToken,
    checkPermissionAny(["downloads", "media manager"]),
    validate(fileUploadValidation.deleteFile),
    fileUploadController.deleteMedia,
  );

export default router;
