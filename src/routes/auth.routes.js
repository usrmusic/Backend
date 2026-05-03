import express from 'express';
import validate from '../middleware/validate.js';
import { userValidation } from '../validation/index.js';
import { userController, tokenController } from '../controllers/index.js';

const router = express.Router();

// Compatibility routes mounted at /auth
router.post('/signin', validate(userValidation.signIn), userController.signIn);
router.post('/refresh', tokenController.refreshToken);
router.post('/signout', tokenController.signOut);

export default router;
