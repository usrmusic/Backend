import dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.resolve(process.cwd(), '.env') });

export default {
  port: process.env.PORT || 4000,
  databaseUrl: process.env.DATABASE_URL,
  auth0: {
    domain: process.env.AUTH0_DOMAIN,
    audience: process.env.AUTH0_AUDIENCE
  },
  resendApiKey: process.env.RESEND_API_KEY
};
