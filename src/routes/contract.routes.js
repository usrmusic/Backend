import express from 'express';
import { verifyAccessToken } from '../middleware/auth0.js';
import { checkPermission } from '../middleware/authorize.js';
import contractController from '../controllers/contract.controller.js';

const router = express.Router();

// Authenticated admin endpoints — manage the contract on behalf of an event.
router.post(
  '/event/:id/token',
  verifyAccessToken,
  checkPermission('confirm event'),
  contractController.ensureContractTokenForEvent,
);

router.post(
  '/event/:id/send',
  verifyAccessToken,
  checkPermission('confirm event'),
  contractController.sendContractLinkEmail,
);

router.get(
  '/event/:id/list',
  verifyAccessToken,
  checkPermission('confirm event'),
  contractController.listContractsForEvent,
);

// Admin endpoints to view/delete an existing Contract row. The `/admin`
// prefix avoids collision with the public `/:token` route below.
router.get(
  '/admin/:id/download',
  verifyAccessToken,
  checkPermission('confirm event'),
  contractController.downloadContract,
);

router.delete(
  '/admin/:id',
  verifyAccessToken,
  checkPermission('confirm event'),
  contractController.deleteContract,
);

// Public endpoints — used by the signer landing page. Token-based access only.
router.get('/:token', contractController.showContractByToken);
router.post('/:token/sign', contractController.signContractByToken);

export default router;
