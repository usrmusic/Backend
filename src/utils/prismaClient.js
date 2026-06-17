import { PrismaClient } from '@prisma/client';
import { PrismaMariaDb } from '@prisma/adapter-mariadb';

const NODE_ENV = process.env.NODE_ENV || 'local';

if (!process.env.DATABASE_URL) {
	throw new Error('DATABASE_URL environment variable is required');
}

// The adapter rewrites mysql:// → mariadb:// internally; pass the URL as-is.
// Timeout params (connectTimeout, socketTimeout, keepAliveDelay) are set via
// query parameters in DATABASE_URL so each environment controls them explicitly.
const adapter = new PrismaMariaDb(process.env.DATABASE_URL);

const prismaOptions = {
	adapter,
	log: NODE_ENV === 'local' ? ['query', 'info', 'warn', 'error'] : ['warn', 'error'],
};

// Avoid creating multiple PrismaClient instances during hot-reload in local dev.
let prisma;
if (NODE_ENV === 'local') {
	if (!global.prisma) {
		global.prisma = new PrismaClient(prismaOptions);
	}
	prisma = global.prisma;
} else {
	prisma = new PrismaClient(prismaOptions);
}

export default prisma;
