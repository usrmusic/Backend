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

  async delete(id, opts = {}) {
    const where = { [this.idField]: id };
    return this.model.delete({ where, ...opts });
  }
}

export default CoreCrudService;
