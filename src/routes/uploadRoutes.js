import express from 'express';
import { createUploadMiddleware } from '../utils/multerConfig.js';
import uploadFile, { getDownloadUrl } from '../utils/uploadHelper.js';
import { verifyAccessToken } from '../middleware/auth0.js';

const router = express.Router();

const upload = createUploadMiddleware();

router.post('/', verifyAccessToken, upload.single('file'), async (req, res, next) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'no_file' });
    const result = await uploadFile(req.file);
    let downloadUrl = result.url;
    if (result.storage === 's3') {
      // result.url is the S3 key
      downloadUrl = await getDownloadUrl(result.key, { expiresInSeconds: 60 * 60 * 24 * 7 });
    }
    res.json({ storage: result.storage, key: result.key, url: downloadUrl });
  } catch (err) {
    next(err);
  }
});

export default router;
