import { PrismaClient } from '@prisma/client';
import { PrismaMariaDb } from '@prisma/adapter-mariadb';

const NODE_ENV = process.env.NODE_ENV || 'local';

// Prisma v7 requires a driver adapter for database connections
// Using MariaDB adapter which works with both MySQL and MariaDB
if (!process.env.DATABASE_URL) {
	throw new Error('DATABASE_URL environment variable is required');
}

// Normalize connection string for the MariaDB adapter:
// The Prisma MariaDB adapter expects a scheme starting with `mariadb://`.
// Many environments provide a `mysql://` URL (Railway, some providers). If
// so, convert `mysql://` to `mariadb://` to satisfy the adapter parser and
// strip any empty password marker like `:@`.
const rawDatabaseUrl = process.env.DATABASE_URL;
if (!rawDatabaseUrl) {
	throw new Error('DATABASE_URL environment variable is required');
}

let adapterUrl = rawDatabaseUrl;
if (rawDatabaseUrl.startsWith('mysql://')) {
	adapterUrl = rawDatabaseUrl.replace(/^mysql:\/\//i, 'mariadb://');
	adapterUrl = adapterUrl.replace(/:@/, '@');
}

const adapter = new PrismaMariaDb(adapterUrl);

// Configure Prisma client options
const prismaOptions = {
	// Driver adapter (required in Prisma v7)
	adapter,
	// More verbose logging in local only.
	log: NODE_ENV === 'local' ? ['query', 'info', 'warn', 'error'] : ['info', 'warn', 'error'],
};

// Avoid creating multiple PrismaClient instances in local (hot-reload).
let prisma;
if (NODE_ENV === 'local') {
	if (!global.prisma) {
		global.prisma = new PrismaClient(prismaOptions);
	}
	prisma = global.prisma;
} else {
	prisma = new PrismaClient(prismaOptions);
}

// Graceful shutdown and cleanup to avoid leaking connections.
const handleShutdown = async (signal) => {
	try {
		if (NODE_ENV === 'local') {
			// keep message minimal in production to avoid leaking info
			console.log(`Received ${signal} - disconnecting Prisma...`);
		}
		await prisma.$disconnect();
		if (NODE_ENV === 'local') console.log('Prisma disconnected');
		// allow process to exit normally
	} catch (err) {
		// eslint-disable-next-line no-console
		console.error('Error while disconnecting Prisma', err);
		process.exit(1);
	}
};

process.once('SIGINT', () => handleShutdown('SIGINT'));
process.once('SIGTERM', () => handleShutdown('SIGTERM'));
process.once('beforeExit', () => handleShutdown('beforeExit'));

process.on('unhandledRejection', async (reason) => {
	// log and shutdown
	// keep message generic to avoid leaking secrets
	// eslint-disable-next-line no-console
	console.error('Unhandled Rejection detected, shutting down');
	if (NODE_ENV === 'local') console.error(reason);
	await handleShutdown('unhandledRejection');
	process.exit(1);
});

process.on('uncaughtException', async (err) => {
	// eslint-disable-next-line no-console
	console.error('Uncaught Exception detected, shutting down');
	if (NODE_ENV === 'local') console.error(err);
	await handleShutdown('uncaughtException');
	process.exit(1);
});

export default prisma;
