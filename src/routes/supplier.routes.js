import express from "express";
import { verifyAccessToken } from "../middleware/auth0.js";
import { checkPermission } from "../middleware/authorize.js";
import { supplierController } from "../controllers/index.js";
import  validate  from "../middleware/validate.js";
import { supplierValidation } from "../validation/index.js";

const router = express.Router();

const protectAdmin = [verifyAccessToken, checkPermission("manage all")];

router
  .route("/")
  .get(
    protectAdmin,
    validate(supplierValidation.listSuppliers),
    supplierController.listSuppliers,
  )
  .post(
    protectAdmin,
    validate(supplierValidation.createSupplier),
    supplierController.createSupplier,
  );
router
  .route("/:id")
  .get(
    protectAdmin,
    validate(supplierValidation.getSupplier),
    supplierController.getSupplier,
  )
  .put(
    protectAdmin,
    validate(supplierValidation.updateSupplier),
    supplierController.updateSupplier,
  )
  .delete(
    protectAdmin,
    validate(supplierValidation.deleteSupplier),
    supplierController.deleteSupplier,
  );
router
  .route("/delete-many/:ids")
  .post(
    protectAdmin,
    validate(supplierValidation.deleteManySuppliers),
    supplierController.deleteManySuppliers,
  );
// router
//   .route("/get-dropdown")
//   .get(
//     protectAdmin,
//     validate(supplierValidation.listSupplierDropdown),
//     supplierController.listSupplierDropdown,
//   );

export default router;
