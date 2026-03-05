import express from "express";
import { verifyAccessToken } from "../middleware/auth0.js";
import checkPermission from "../middleware/authorize.js";
import { rolePermissionController } from "../controllers/index.js";
import catchAsync from "../utils/catchAsync.js";
import validate from "../middleware/validate.js";
import { rolePermissionValidation } from "../validation/index.js";

const router = express.Router();

// All admin routes require auth + manage access permission
const protectAdmin = [verifyAccessToken, checkPermission("manage all")];

router
  .route("/roles")
  .post(
    protectAdmin,
    validate(rolePermissionValidation.storeRole),
    catchAsync(rolePermissionController.storeRole),
  );

router
  .route("/roles/:id")
  .put(
    protectAdmin,
    validate(rolePermissionValidation.updateRole),
    catchAsync(rolePermissionController.updateRole),
  )
  .delete(
    protectAdmin,
    validate(rolePermissionValidation.destroyRole),
    catchAsync(rolePermissionController.destroyRole),
  );

router
  .route("/roles/:id/permissions")
  .get(
    protectAdmin,
    validate(rolePermissionValidation.getRolePermissions),
    catchAsync(rolePermissionController.getRolePermissions),
  );

router
  .route("/permissions")
  .post(
    protectAdmin,
    validate(rolePermissionValidation.storePermission),
    catchAsync(rolePermissionController.storePermission),
  );

router
  .route("/permissions/:id")
  .put(
    protectAdmin,
    validate(rolePermissionValidation.updatePermission),
    catchAsync(rolePermissionController.updatePermission),
  )
  .delete(
    protectAdmin,
    validate(rolePermissionValidation.destroyPermission),
    catchAsync(rolePermissionController.destroyPermission),
  );

router
  .route("/manage-access")
  .get(protectAdmin, catchAsync(rolePermissionController.index));

router
  .route("/assign")
  .post(
    protectAdmin,
    validate(rolePermissionValidation.assignPermissions),
    catchAsync(rolePermissionController.assignPermissions),
  );

export default router;
