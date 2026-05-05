import express from 'express';
import { verifyAccessToken } from '../middleware/auth0.js';
import { requireAdmin } from '../middleware/authorize.js';
import {todoController} from '../controllers/index.js';
import validate from '../middleware/validate.js';
import {todoValidation} from '../validation/index.js';

const router = express.Router();
// Read endpoints are open to any authenticated user. Mutations
// (create/update/delete) are admin-only. The complete-toggle has a
// runtime check that allows the assigned user as well.
const authOnly = [verifyAccessToken];
const adminGuard = [verifyAccessToken, requireAdmin];

// Todos for the current user
router.route('/mine')
    .get(authOnly, todoController.listAssignedTodos);

router.route('/:id')
    .get(authOnly, validate(todoValidation.listTodo), todoController.listTodo)
    .post(adminGuard, validate(todoValidation.createTodo), todoController.createTodo);

router.route('/:eventId/:todoId')
    .put(adminGuard, validate(todoValidation.updateTodo), todoController.updateTodo)
    .delete(adminGuard, validate(todoValidation.deleteTodo), todoController.deleteTodo);

router.route('/:eventId/:todoId/complete')
    .patch(authOnly, validate(todoValidation.toggleComplete), todoController.toggleTodoComplete);

export default router;
