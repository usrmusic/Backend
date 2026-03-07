import express from 'express';
import path from 'path';
import helmet from 'helmet';
import morgan from 'morgan';
import cors from 'cors';
import routes from './routes/index.js';
import errorHandler from './utils/errorHandler.js';
import AppError from './utils/AppError.js';

const app = express();

app.use(helmet());
app.use(morgan('dev'));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// CORS: allow requests from the frontend hosts listed below (and allow no-origin requests)
const allowedOrigins = [
	'http://localhost:3000',
	'https://usrmusic.com',
	'http://usrmusic.com'
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

// 404 for unknown routes
app.use((req, res, next) => {
	next(new AppError('not_found', 404));
});

// Centralized error handler
app.use(errorHandler);

export default app;
