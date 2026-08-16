import prisma from '../utils/prismaClient.js';
import { uploadFile } from '../utils/uploadHelper.js';
import genPassword from '../utils/genPassword.js';
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import { serializeForJson } from '../utils/serialize.js';
import resendClient from '../utils/mail/resendClient.js';
import service from "./index.js";

const userSvc = service.get('user');

const JWT_SECRET = process.env.JWT_SECRET;

export async function createUser({ name, email, contact_number, role_id, address, color }, file, sendEmail) {
  const plainPassword = genPassword();
  const hashed = await bcrypt.hash(plainPassword, 10);

  // Default to role 4 (Client), the least-privileged role — NOT role 1
  // (Super Admin). A missing role_id must never silently mint an admin.
  const roleId = role_id != null ? BigInt(role_id) : BigInt(4);

  let profilePhotoUrl = null;
  if (file) {
    try {
      const uploadRes = await uploadFile(file, {
        allowedMimeTypes: [
          'image/jpeg',
          'image/png',
          'image/gif',
          'image/webp',
          'image/svg+xml',
        ],
        folder: 'profile',
      });
      if (uploadRes && uploadRes.url) profilePhotoUrl = uploadRes.url;
    } catch (err) {
      // Don't block user creation on upload failure; log and continue
      console.error('userService.uploadFile error', err);
    }
  }

  const data = {
    role_id: roleId,
    name: name || null,
    email,
    password: hashed,
    password_text: plainPassword,
    contact_number: contact_number || '',
    address: address || null,
    // Lets a DJ's calendar colour be set at creation time, not only via the
    // dedicated DJ Colours settings screen — empty string clears to null (the
    // grey-fallback state), same as the updateUser path.
    color: color || null,
    is_email_send: !!sendEmail,
    profile_photo: profilePhotoUrl,
    deleted_at: null,
    created_by: null,
    updated_by: null,
  };

  const user = await userSvc.create(data);

  // typ:'email_verify' so this token can't be replayed as an access session
  // (verifyAccessToken rejects any typ !== 'access'). It is returned in the
  // create-user API response, so this separation matters.
  const tokenPayload = serializeForJson({ sub: user.id, email: user.email, typ: 'email_verify' });
  const verifyToken = jwt.sign(tokenPayload, JWT_SECRET, { expiresIn: '1h' });

  let emailSent = false;
  let resendResult = null;
  if (sendEmail) {
    try {
      const sendRes = await resendClient({
        to: user.email,
        subject: 'Verify your email',
        html: `<p>Hello ${user.name || ''},</p><p>Your verification code (or link) is:</p><pre>${verifyToken}</pre><p>Or click: <a href="/verify?token=${verifyToken}">Verify email</a></p>`,
      });
      resendResult = sendRes;
      console.log('userService.resendClient result', resendResult);
      if (sendRes && sendRes.ok && !sendRes.fallback) emailSent = true;
    } catch (err) {
      resendResult = err;
      console.error('userService.resendClient error', err);
    }
  }

  return { user, plainPassword, verifyToken, emailSent, resendResult };
}

const getUserByEmail = async (email) => {
  return prisma.user.findUnique({ where: { email } });
};
export default { createUser, getUserByEmail };
