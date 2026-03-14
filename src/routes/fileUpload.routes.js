import express from "express";
import { mediaUpload, fileUpload } from "../utils/multerConfig.js";
import { verifyAccessToken } from "../middleware/auth0.js";
import validate from "../middleware/validate.js";
import { fileUploadController } from "../controllers/index.js";
import { fileUploadValidation } from "../validation/index.js";
import { checkPermission } from "../middleware/authorize.js";

const router = express.Router();
const upload = fileUpload;

router
  .route("/uploads")
  .get(
    verifyAccessToken,
    checkPermission("manage all"),
    validate(fileUploadValidation.listFiles),
    fileUploadController.listFiles,
  )
  .post(
    verifyAccessToken,
    checkPermission("manage all"),
    upload.single("file"),
    validate(fileUploadValidation.uploadfile),
    fileUploadController.uploadfile,
  );
router
  .route("/media")
  .get(
    verifyAccessToken,
    checkPermission("manage all"),
    validate(fileUploadValidation.listFiles),
    fileUploadController.listMedia,
  )
  .post(
    verifyAccessToken,
    checkPermission("manage all"),
    // accept either `media` or `file` form field to match frontend variations
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
    checkPermission("manage all"),
    validate(fileUploadValidation.getFile),
    fileUploadController.getFile,
  )
  .put(
    verifyAccessToken,
    checkPermission("manage all"),
    validate(fileUploadValidation.updateFileMetadata),
    fileUploadController.updateFileMetadata,
  )
  .delete(
    verifyAccessToken,
    checkPermission("manage all"),
    validate(fileUploadValidation.deleteFile),
    fileUploadController.deleteFile,
  );
router
  .route("/uploads/:id/download")
  .get(
    verifyAccessToken,
    checkPermission("manage all"),
    validate(fileUploadValidation.downloadFile),
    fileUploadController.downloadFile,
  );
router
  .route("/media/:id/")
  .get(
    verifyAccessToken,
    checkPermission("manage all"),
    validate(fileUploadValidation.downloadFile),
    fileUploadController.downloadMedia,
  );

// // List files (optional ?event_id)
// router.get('/', verifyAccessToken, controller.listFiles);

// // Upload a file and create DB record
// router.post('/', verifyAccessToken, upload.single('file'), controller.storeFile);

// // Get metadata + download url
// router.get('/:id', verifyAccessToken, controller.getFile);

// // Get a presigned download url (or direct download for local)
// router.get('/:id/download', verifyAccessToken, controller.downloadFile);

export default router;
