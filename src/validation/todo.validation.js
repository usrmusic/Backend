import Joi from "joi";

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
        deadline: Joi.date().iso().required(),
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
        deadline: Joi.date().iso().required(),
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


export default { listTodo, createTodo, updateTodo, deleteTodo };