import express from 'express';
import multer from 'multer';
import path from 'path';
import { verifyAccessToken } from '../middleware/auth0.js';

const router = express.Router();

const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, path.resolve(process.cwd(), 'uploads'));
  },
  filename: function (req, file, cb) {
    const name = `${Date.now()}-${file.originalname}`;
    cb(null, name);
  }
});

const upload = multer({ storage });

router.post('/', verifyAccessToken, upload.single('file'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'no_file' });
  res.json({ filename: req.file.filename, path: req.file.path });
});

export default router;
