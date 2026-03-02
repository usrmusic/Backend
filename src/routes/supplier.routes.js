import express from 'express';
import { verifyAccessToken } from '../middleware/auth0.js';
import { checkPermission } from '../middleware/authorize.js';
import supplierController from '../controllers/supplierController.js';

const router = express.Router();

const protectAdmin = [verifyAccessToken, checkPermission('manage all')];

router.route("/")
    .get(protectAdmin, supplierController.listSuppliers)
    .post(protectAdmin, supplierController.createSupplier);
router.route("/:id")
    .get(protectAdmin, supplierController.getSupplier)
    .put(protectAdmin, supplierController.updateSupplier)
    .delete(protectAdmin, supplierController.deleteSupplier);
router.route("/delete-many")
    .post(protectAdmin, supplierController.deleteManySuppliers);
router.route("/get-dropdown")
    .get(protectAdmin, supplierController.listSupplierDropdown);


export default router;
