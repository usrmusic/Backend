import Joi from "joi";

// Matches Laravel's StoreTodoRequest/UpdateTodoRequest `after_or_equal:today`
// rule, which compares by calendar date, not exact timestamp — so "today" at
// any time of day must still pass. `min('now')` would incorrectly reject
// earlier times today, so compare against the start of today instead,
// computed fresh on every validation (not frozen at module load).
const deadlineSchema = Joi.date()
  .iso()
  .custom((value, helpers) => {
    const startOfToday = new Date();
    startOfToday.setHours(0, 0, 0, 0);
    if (value < startOfToday) {
      return helpers.error("date.min", { limit: "today" });
    }
    return value;
  }, "deadline not before today")
  .messages({ "date.min": "deadline must be today or later" })
  .required();

const listTodo = Joi.object({
    params: Joi.object({
        id: Joi.number().integer().required(),
    }),
});

const createTodo = Joi.object({
    params: Joi.object({
        id: Joi.number().integer().required(),
    }),
    body: Joi.object({
        assigned_to: Joi.number().integer().required(),
        action: Joi.string().required(),
        deadline: deadlineSchema,
        comment: Joi.string().optional(),
        complete: Joi.boolean().required(),
    }),
});

const updateTodo = Joi.object({
    params: Joi.object({
        eventId: Joi.number().integer().required(),
        todoId: Joi.number().integer().required(),
    }),
    body: Joi.object({
        assigned_to: Joi.number().integer().required(),
        action: Joi.string().required(),
        deadline: deadlineSchema,
        comment: Joi.string().optional(),
        complete: Joi.boolean().required(),
    }),
});

const deleteTodo = Joi.object({
    params: Joi.object({
        eventId: Joi.number().integer().required(),
        todoId: Joi.number().integer().required(),
    }),
    query: Joi.object({
        force: Joi.boolean().optional(),
    }).optional(),
    body: Joi.object({
        force: Joi.boolean().optional(),
    }).optional(),
});

const toggleComplete = Joi.object({
    params: Joi.object({
        eventId: Joi.number().integer().required(),
        todoId: Joi.number().integer().required(),
    }),
    body: Joi.object({
        complete: Joi.boolean().required(),
    }),
});


export default { listTodo, createTodo, updateTodo, deleteTodo, toggleComplete };