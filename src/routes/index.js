import express from 'express';
import uploadRoutes from './uploadRoutes.js';
import authRoutes from './auth.js';
import rolePermissionRoutes from './rolePermissionRoutes.js';
import clientRoutes from './clientRoutes.js';
import venueRoutes from './venueRoutes.js';
import supplierRoutes from './supplierRoutes.js';
import packageTypeRoutes from './packageTypeRoutes.js';
import packageUserRoutes from './packageUserRoutes.js';
import companyRoutes from './companyRoutes.js';
import emailContentRoutes from './emailContentRoutes.js';

const router = express.Router();

router.use('/upload', uploadRoutes);
router.use('/auth', authRoutes);
// Admin role & permission management mounted under /admin
router.use('/admin', rolePermissionRoutes);
// Client CRUD mounted under /clients
router.use('/clients', clientRoutes);
// Venues CRUD
router.use('/venues', venueRoutes);
// Suppliers CRUD
router.use('/suppliers', supplierRoutes);
// Package types and package users
router.use('/packages/types', packageTypeRoutes);
router.use('/packages/users', packageUserRoutes);
// Company name CRUD (frontend expects /company-name routes)
router.use('/', companyRoutes);
// Email Content routes
router.use('/', emailContentRoutes);

export default router;
