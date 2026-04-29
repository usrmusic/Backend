import express from "express";
import { verifyAccessToken } from "../middleware/auth0.js";
import { checkPermission } from "../middleware/authorize.js";
import { equipmentController } from "../controllers/index.js";
import validate from "../middleware/validate.js";
import { equipmentValidation } from "../validation/index.js";
const router = express.Router();
const protectAdmin = [verifyAccessToken, checkPermission("manage all")];

router
  .route("/")
  .get(
    protectAdmin,
    validate(equipmentValidation.listEquipment),
    equipmentController.listEquipment,
  )
  .post(
    protectAdmin,
    validate(equipmentValidation.createEquipment),
    equipmentController.createEquipment,
  );
router
  .route("/get-dropdown")
  .get(verifyAccessToken, equipmentController.getEquipmentDropdown);
router
  .route("/:id")
  .get(
    protectAdmin,
    validate(equipmentValidation.getEquipment),
    equipmentController.getEquipment,
  )
  .put(
    protectAdmin,
    validate(equipmentValidation.updateEquipment),
    equipmentController.updateEquipment,
  )
  .delete(
    protectAdmin,
    validate(equipmentValidation.deleteEquipment),
    equipmentController.deleteEquipment,
  );
router
  .route("/delete-many/:ids")
  .delete(
    protectAdmin,
    validate(equipmentValidation.deleteManyEquipment),
    equipmentController.deleteManyEquipment,
  );

export default router;
