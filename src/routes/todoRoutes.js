import express from 'express';
import { verifyAccessToken } from '../middleware/auth0.js';
import { checkPermission } from '../middleware/authorize.js';
import todoController from '../controllers/todoController.js';

const router = express.Router();
const protectAdmin = [verifyAccessToken, checkPermission('manage all')];
const protectAuth = [verifyAccessToken];

router.get('/', protectAdmin, todoController.listTodos);
router.get('/completed', protectAdmin, todoController.listCompletedTodos);
router.get('/events', protectAdmin, todoController.getEvents);
router.get('/created-by', protectAdmin, todoController.getCreatedBy);
router.get('/assigned-to', protectAdmin, todoController.getAssignedTo);
router.get('/clients', protectAdmin, todoController.getClientsForTodo);

router.post('/', protectAuth, todoController.createTodo);
router.put('/:id', protectAuth, todoController.updateTodo);
router.delete('/', protectAdmin, todoController.deleteTodos);

export default router;
