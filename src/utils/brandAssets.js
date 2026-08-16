import { getObjectBuffer } from './s3Client.js';

/* Company logo resolution for generated documents.

   The HTML templates built `${APP_URL}public/storage/images/${company_logo}` —
   a Laravel storage path, with APP_URL unset everywhere checked. It resolved
   to a relative URL that could never load, so every invoice and quote ever
   sent rendered the alt text "logo" where the logo should be.

   `company_names.company_logo` holds three different shapes, accumulated over
   the app's life, and all three have live rows:

     1. Legacy Laravel bare filename   "USRNEW.jpg"
     2. Node local upload path         "/uploads/company/logo/177…-avatar.png"
     3. Node S3 object key             "company/logo/177…-33fff4bb2726.jpg"

   Rule that matters: when a logo cannot be resolved we fall back to the company
   NAME in type, never to another company's mark. Six companies share
   USRNEW.jpg, but TPR.jpg (The Printer Room) and Eventiv.jpg are different
   brands — a naive "default to the USR logo" would brand their documents as
   USR.

   The USR brand assets themselves (the dark/white wordmark, the admin
   signature) live in S3 under `brand/`, not shipped inside the app image —
   see scripts/uploadBrandAssets.js for how they got there. */

const BUCKET_PREFIX = 'brand/';

/* The legacy filename IS resolvable: it's the USR wordmark, uploaded to S3
   once as `brand/usr-logo-dark.png` (extracted from the base64 fallback
   embedded in the old invoice blade). Anything else legacy-shaped stays
   unresolved on purpose rather than guessed at. */
const LEGACY_MAP = {
  'usrnew.jpg': 'usr-logo-dark.png',
};

const IMAGE_EXT = /\.(png|jpe?g)$/i;

// Static brand assets don't change between requests; a PDF render fetching
// them from S3 fresh every time would be pure waste. TTL just guards against
// a stale process outliving a re-upload.
const CACHE_TTL_MS = 30 * 60 * 1000;
const cache = new Map(); // key -> { buf, at }

async function fetchS3(key) {
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.buf;
  try {
    const buf = await getObjectBuffer(key);
    cache.set(key, { buf, at: Date.now() });
    return buf;
  } catch (_) {
    return null;
  }
}

export function brandAsset(name) {
  return fetchS3(`${BUCKET_PREFIX}${name}`);
}

/* PDFKit embeds JPEG and PNG only, and needs bytes rather than a URL — hence
   Buffer rather than a src string. Returns null when nothing resolves, and the
   caller sets the company name in type instead. */
export async function resolveCompanyLogo(companyDetails = {}) {
  const raw = String(companyDetails.company_logo || '').trim();
  if (!raw) return null;
  if (!IMAGE_EXT.test(raw)) return null;

  const base = raw.split('/').pop();

  // 1 — legacy filename we happen to hold a real copy of
  const mapped = LEGACY_MAP[base.toLowerCase()];
  if (mapped) {
    const buf = await brandAsset(mapped);
    if (buf) return buf;
  }

  // 2/3 — everything the Node app itself uploaded (local path or S3 key) was
  // put there by uploadFile() in uploadHelper.js, which under FILE_STORAGE=s3
  // stores the object at the key the DB row holds verbatim. A bare local path
  // (FILE_STORAGE unset) will simply 404 against S3 and fall through to null,
  // same end result as the old behaviour for that case.
  const key = raw.replace(/^\/+/, '').replace(/^uploads\//, '');
  return fetchS3(key);
}

export default { resolveCompanyLogo, brandAsset };
