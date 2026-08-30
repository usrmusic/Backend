import express from 'express';
import path from 'path';
import helmet from 'helmet';
import morgan from 'morgan';
import compression from 'compression';
import cors from 'cors';
import routes from './routes/index.js';
import errorHandler from './utils/errorHandler.js';
import AppError from './utils/AppError.js';
import prisma from './utils/prismaClient.js';

const app = express();

// Behind Railway's proxy — required for req.ip to reflect the real client
// (X-Forwarded-For) rather than the proxy, so the login rate limiter keys on
// the actual caller. Trust exactly one hop.
app.set('trust proxy', 1);

app.use(helmet());
app.use(compression());
app.use(morgan(process.env.NODE_ENV === 'production' ? 'tiny' : 'dev'));
// Cap request body size to blunt memory-exhaustion DoS. 2mb comfortably covers
// the largest legitimate JSON payload (a base64 signature data URI from the
// contract-signing canvas is well under that); non-file endpoints never need more.
app.use(express.json({ limit: '2mb' }));
app.use(express.urlencoded({ extended: true, limit: '2mb' }));

// CORS: allow requests from the frontend hosts listed below (and allow no-origin requests)
const allowedOrigins = [
	'http://localhost:3000',
	'https://usrmusic.com',
	'http://usrmusic.com',
	'https://www.usrmusic.com',
	'http://www.usrmusic.com',
	'https://usr-music.vercel.app',
	'https://usrmusic.vercel.app'
];

app.use(
	cors({
		origin(origin, callback) {
			// Allow requests with no origin (like mobile apps, curl), or from allowedOrigins
			if (!origin || allowedOrigins.includes(origin)) {
				callback(null, true);
			} else {
				callback(new Error('Not allowed by CORS'));
			}
		},
		credentials: true
	})
);
app.options('*', cors());

// Serve uploaded files from the persistent uploads dir (Railway volume) or ./uploads
const uploadsDir = process.env.PERSISTENT_UPLOADS_DIR
	? path.resolve(process.env.PERSISTENT_UPLOADS_DIR)
	: path.resolve(process.cwd(), 'uploads');
app.use('/uploads', express.static(uploadsDir));

app.use('/api', routes);

app.get('/', (req, res) => res.json({ status: 'ok' }));

// Health check — used by Railway, load balancers, and readiness probes.
// Hits the DB so it reflects actual connectivity, not just process liveness.
app.get('/health', async (req, res) => {
  try {
    await prisma.$queryRaw`SELECT 1`;
    res.json({ status: 'ok' });
  } catch (err) {
    res.status(503).json({ status: 'error', message: 'database unreachable' });
  }
});

// 404 for unknown routes
app.use((req, res, next) => {
	next(new AppError('not_found', 404));
});

// Centralized error handler
app.use(errorHandler);

export default app;
