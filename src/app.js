import express from 'express';
import path from 'path';
import helmet from 'helmet';
import morgan from 'morgan';
import routes from './routes/index.js';
import errorHandler from './utils/errorHandler.js';
import AppError from './utils/AppError.js';

const app = express();

app.use(helmet());
app.use(morgan('dev'));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

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
