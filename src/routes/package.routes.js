import express from "express";
import { verifyAccessToken } from "../middleware/auth0.js";
import { checkPermission } from "../middleware/authorize.js";
import { packageController } from "../controllers/index.js";
import validate from "../middleware/validate.js";
import { packageValidation } from "../validation/index.js";

const router = express.Router();
const protectAdmin = [verifyAccessToken, checkPermission("manage all")];

router
  .route("/")
  .get(
    protectAdmin,
    validate(packageValidation.listPackages),
    packageController.listPackages,
  )
  .post(
    protectAdmin,
    validate(packageValidation.createPackage),
    packageController.createPackage,
  );
router.route("/get-dropdown")
  .get(verifyAccessToken, packageController.getPackageDropdown);
router
  .route("/:id")
  .get(
    protectAdmin,
    validate(packageValidation.getPackage),
    packageController.getPackage,
  )
  .put(
    protectAdmin,
    validate(packageValidation.updatePackage),
    packageController.updatePackage,
  )
  .delete(
    protectAdmin,
    validate(packageValidation.deletePackage),
    packageController.deletePackage,
  );
router
  .route("/delete-many")
  .post(
    protectAdmin,
    validate(packageValidation.deleteManyPackages),
    packageController.deleteManyPackages,
  );
// router.route('/types')
// 	.get(protectAdmin, packageTypeController.listPackageTypes)
// 	.post(protectAdmin, packageTypeController.createPackageType);
// router.route('/types/:id')
// 	.get(protectAdmin, packageTypeController.getPackageType)
// 	.put(protectAdmin, packageTypeController.updatePackageType)
// 	.delete(protectAdmin, packageTypeController.deletePackageType);
// router.route('/users')
//     .get(protectAdmin, validate(packageValidation.listPackages), packageUserController.listPackageUsers)
//     .post(protectAdmin, validate(packageValidation.createPackage), packageUserController.createPackageUser);
// router.route('/users/:id')
//     .get(protectAdmin, validate(packageValidation.getPackage), packageUserController.getPackageUser)
//     .put(protectAdmin, validate(packageValidation.updatePackage), packageUserController.updatePackageUser)
//     .delete(protectAdmin, validate(packageValidation.deletePackage), packageUserController.deletePackageUser);
// router.route('/users-equipment')
//     .get(protectAdmin, pueController.listPackageUserEquipment)
// router.route('/users-equipment/:package_user_id/equipment/:equipment_id')
//     .get(protectAdmin, pueController.getPackageUserEquipment)
//     .post(protectAdmin, pueController.createPackageUserEquipment)
//     .put(protectAdmin, pueController.updatePackageUserEquipment)
//     .delete(protectAdmin, pueController.deletePackageUserEquipment);
// router.route('/user-event')
//     .get(protectAdmin, eventPackageController.listEventPackages)
//     .post(protectAdmin, eventPackageController.createEventPackage);
// router.route('/user-event/:id')
//     .get(protectAdmin, eventPackageController.getEventPackage)
//     .put(protectAdmin, eventPackageController.updateEventPackage)
//     .delete(protectAdmin, eventPackageController.deleteEventPackage);

export default router;
