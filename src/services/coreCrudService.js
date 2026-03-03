import prisma from '../utils/prismaClient.js';

class CoreCrudService {
  constructor(modelKey, idField = 'id') {
    this.modelKey = modelKey;
    this.idField = idField;
    this.model = prisma[this.modelKey];
    if (!this.model) {
      throw new Error(`Prisma model "${this.modelKey}" not found on Prisma client`);
    }
  }

  _buildQueryOptions(query = {}) {
    const { filter, sort, page = 1, perPage = 25, select, include } = query;
    const where = filter || {};

    let orderBy;
    if (sort) {
      orderBy = String(sort).split(',').map((s) => {
        const [field, dir = 'asc'] = s.split(':').map((p) => p.trim());
        return { [field]: dir };
      });
    }

    const take = perPage ? parseInt(perPage, 10) : undefined;
    const skip = page && take ? (parseInt(page, 10) - 1) * take : undefined;

    const opts = {};
    if (Object.keys(where).length) opts.where = where;
    if (orderBy) opts.orderBy = orderBy;
    if (typeof take === 'number' && !Number.isNaN(take)) opts.take = take;
    if (typeof skip === 'number' && !Number.isNaN(skip)) opts.skip = skip;
    if (select) opts.select = select;
    if (include) opts.include = include;

    return opts;
  }

  async list(query = {}) {
    const opts = this._buildQueryOptions(query);
    return this.model.findMany(opts);
  }

  async getById(id, opts = {}) {
    const where = { [this.idField]: id };
    return this.model.findUnique({ where, ...opts });
  }

  async create(data, opts = {}) {
    return this.model.create({ data, ...opts });
  }

  async update(id, data, opts = {}) {
    const where = { [this.idField]: id };
    return this.model.update({ where, data, ...opts });
  }

  // Soft-delete by default if `deleted_at` exists in the model (sets timestamp).
  // If `opts.force` is true, or the model/schema doesn't support `deleted_at`,
  // fall back to permanent deletion using `delete`.
  async delete(id, opts = {}) {
    const where = { [this.idField]: id };
    if (opts.force) return this.model.delete({ where, ...opts });

    try {
      return await this.model.update({ where, data: { deleted_at: new Date() }, ...opts });
    } catch (err) {
      // If Prisma model doesn't have `deleted_at`, fallback to hard delete.
      if (err && err.name === 'PrismaClientValidationError') {
        return this.model.delete({ where, ...opts });
      }
      throw err;
    }
  }

  // Soft-delete many records by IDs. `ids` should be an array of identifier values.
  // If `opts.force` is true, perform permanent deletion with `deleteMany`.
  async deleteMany(ids = [], opts = {}) {
    if (!Array.isArray(ids) || ids.length === 0) return { count: 0 };
    const where = { [this.idField]: { in: ids } };
    if (opts.force) return this.model.deleteMany({ where });

    try {
      return await this.model.updateMany({ where, data: { deleted_at: new Date() } });
    } catch (err) {
      if (err && err.name === 'PrismaClientValidationError') {
        return this.model.deleteMany({ where });
      }
      throw err;
    }
  }

  // Force permanent delete of a single record
  async forceDelete(id, opts = {}) {
    const where = { [this.idField]: id };
    return this.model.delete({ where, ...opts });
  }

  // Force permanent delete of multiple records
  async forceDeleteMany(ids = [], opts = {}) {
    if (!Array.isArray(ids) || ids.length === 0) return { count: 0 };
    const where = { [this.idField]: { in: ids } };
    return this.model.deleteMany({ where, ...opts });
  }
}

export default CoreCrudService;
