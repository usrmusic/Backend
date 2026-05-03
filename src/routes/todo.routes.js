import express from 'express';
import { verifyAccessToken } from '../middleware/auth0.js';
import { checkPermission } from '../middleware/authorize.js';
import {todoController} from '../controllers/index.js';
import validate from '../middleware/validate.js';
import {todoValidation} from '../validation/index.js';

const router = express.Router();
// Todos are visible to all authenticated roles in the Laravel app
// (Super Admin / Admin / Staff / Client) so we just require auth here.
const protectAdmin = [verifyAccessToken];

router.route('/:id')
    .get(protectAdmin, validate(todoValidation.listTodo), todoController.listTodo)
    .post(protectAdmin, validate(todoValidation.createTodo), todoController.createTodo);

router.route('/:eventId/:todoId')
    .put(protectAdmin, validate(todoValidation.updateTodo), todoController.updateTodo)
    .delete(protectAdmin, validate(todoValidation.deleteTodo), todoController.deleteTodo);

export default router;
