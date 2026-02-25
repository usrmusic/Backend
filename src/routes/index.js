import express from 'express';
import uploadRoutes from './uploadRoutes.js';
import fileUploadRoutes from './fileUploadRoutes.js';
import authRoutes from './auth.js';
import rolePermissionRoutes from './rolePermissionRoutes.js';
import clientRoutes from './clientRoutes.js';
import venueRoutes from './venueRoutes.js';
import supplierRoutes from './supplierRoutes.js';
import packageTypeRoutes from './packageTypeRoutes.js';
import packageUserRoutes from './packageUserRoutes.js';
import packageUserEquipmentRoutes from './packageUserEquipmentRoutes.js';
import eventPackageRoutes from './eventPackageRoutes.js';
import equipmentRoutes from './equipmentRoutes.js';
import paymentMethodRoutes from './paymentMethodRoutes.js';
import eventPaymentRoutes from './eventPaymentRoutes.js';
import companyRoutes from './companyRoutes.js';
import emailContentRoutes from './emailContentRoutes.js';
import rigListRoutes from './rigListRoutes.js';
import eventNoteRoutes from './eventNoteRoutes.js';
import contractRoutes from './contractRoutes.js';
import signatureRoutes from './signatureRoutes.js';
import todoRoutes from './todoRoutes.js';
import enquiryRoutes from './enquiryRoutes.js';

const router = express.Router();

router.use('/upload', uploadRoutes);
// Laravel-like file uploads
router.use('/file-uploads', fileUploadRoutes);
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
// package user equipment mappings
router.use('/packages/users/equipment', packageUserEquipmentRoutes);
// Event packages
router.use('/packages/event', eventPackageRoutes);
// Equipment CRUD
router.use('/equipment', equipmentRoutes);
// Payment methods & event payments
router.use('/payments/methods', paymentMethodRoutes);
router.use('/payments/event', eventPaymentRoutes);
// Company name CRUD (frontend expects /company-name routes)
router.use('/', companyRoutes);
// Email Content routes
router.use('/', emailContentRoutes);
// Rig list routes (requires 'rig list' permission)
router.use('/', rigListRoutes);
// Event notes
router.use('/events/notes', eventNoteRoutes);
// Contracts and signatures
router.use('/contracts', contractRoutes);
router.use('/signatures', signatureRoutes);
// Enquiries (create / lookup)
router.use('/enquiries', enquiryRoutes);
// Todos
router.use('/todos', todoRoutes);

export default router;
