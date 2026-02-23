import express from 'express';
import controller from '../controllers/authController.js';
import catchAsync from '../utils/catchAsync.js';
import path from 'path';
import { imageUpload } from '../utils/multerConfig.js';
import tokenController from '../controllers/tokenController.js';
import { allowOwnerOr } from '../middleware/authorize.js';
const upload = imageUpload;
import { verifyAccessToken } from '../middleware/auth0.js';
import checkPermission from '../middleware/authorize.js';

const router = express.Router();



router.post('/signin', catchAsync(controller.signIn));
router.post('/signup', upload.single('profile_photo'), catchAsync(controller.signUp));
router.post('/refresh', catchAsync(tokenController.refreshToken));
router.post('/signout', catchAsync(tokenController.signOut));
router.post('/forgot', catchAsync(controller.forgotPassword));
router.post('/verify', catchAsync(controller.verifyEmail));
router.get('/users/roles', verifyAccessToken, catchAsync(controller.listRoles));
router.get('/users', verifyAccessToken, catchAsync(controller.listUsers));
router.put('/users/:id', verifyAccessToken, allowOwnerOr('manage_users'), catchAsync(controller.updateUser));
router.delete('/users/:id', verifyAccessToken, checkPermission('manage_users'), catchAsync(controller.deleteUser));
router.post('/users/delete-many', verifyAccessToken, checkPermission('manage_users'), catchAsync(controller.deleteManyUsers));

export default router;

