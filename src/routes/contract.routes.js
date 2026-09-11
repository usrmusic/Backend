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

// Public: permanent download link for the client's signed contract, emailed
// to them once at signing time. Redirects to a freshly-generated presigned
// S3 URL on every hit instead of embedding one directly in the email body —
// a presigned URL maxes out at 7 days (AWS SigV4 limit for long-term IAM
// credentials), so a client opening the emailed link after that returned
// AccessDenied. This route never expires because the presign happens here,
// at click time, not once at send time.
router.get('/:token/download', contractController.downloadSignedContractByToken);

export default router;
