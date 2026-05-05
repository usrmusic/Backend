import express from "express";
import { mediaUpload, fileUpload } from "../utils/multerConfig.js";
import { verifyAccessToken } from "../middleware/auth0.js";
import validate from "../middleware/validate.js";
import { fileUploadController } from "../controllers/index.js";
import { fileUploadValidation } from "../validation/index.js";
import { checkPermission } from "../middleware/authorize.js";

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
    checkPermission("downloads"),
    validate(fileUploadValidation.listFiles),
    fileUploadController.listMedia,
  )
  .post(
    verifyAccessToken,
    checkPermission("downloads"),
    mediaUpload.fields([
      { name: "media", maxCount: 1 },
      { name: "file", maxCount: 1 },
    ]),
    fileUploadController.uploadMedia,
  );

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
    checkPermission("downloads"),
    validate(fileUploadValidation.downloadFile),
    fileUploadController.downloadMedia,
  )
  .delete(
    verifyAccessToken,
    checkPermission("downloads"),
    validate(fileUploadValidation.deleteFile),
    fileUploadController.deleteMedia,
  );

export default router;
