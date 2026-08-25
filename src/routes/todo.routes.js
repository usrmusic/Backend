import express from 'express';
import { verifyAccessToken } from '../middleware/auth0.js';
import { checkPermission } from '../middleware/authorize.js';
import {todoController} from '../controllers/index.js';
import validate from '../middleware/validate.js';
import {todoValidation} from '../validation/index.js';

const router = express.Router();
// Read endpoints are open to any authenticated user. Mutations
// (create/update/delete) require the "confirm event" permission — matching
// the legacy Laravel CRM, where todo routes sit inside the same can:confirm
// event group with no extra role restriction, so Staff (who hold that
// permission) can manage todos same as Admin; only Client is excluded
// (Client never holds "confirm event"). The complete-toggle has a runtime
// check that allows the assigned user as well.
const authOnly = [verifyAccessToken];
const adminGuard = [verifyAccessToken, checkPermission('confirm event')];

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
