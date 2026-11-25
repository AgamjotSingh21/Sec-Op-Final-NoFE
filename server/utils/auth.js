import crypto from 'crypto';

const JWT_SECRET = process.env.JWT_SECRET || 'secondopinion-secret-key-2026-auth';

export function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.pbkdf2Sync(password, salt, 1000, 64, 'sha512').toString('hex');
  return { salt, hash };
}

export function verifyPassword(password, savedHash, salt) {
  const hash = crypto.pbkdf2Sync(password, salt, 1000, 64, 'sha512').toString('hex');
  return hash === savedHash;
}

export function generateToken(user) {
  const payload = {
    id: user.id || user._id,
    email: user.email,
    name: user.name,
    avatarInitial: user.avatarInitial || (user.name ? user.name[0].toUpperCase() : 'M')
  };
  const str = JSON.stringify(payload);
  const base64Payload = Buffer.from(str).toString('base64url');
  const signature = crypto
    .createHmac('sha256', JWT_SECRET)
    .update(base64Payload)
    .digest('base64url');

  return `${base64Payload}.${signature}`;
}

export function verifyToken(token) {
  if (!token || typeof token !== 'string') return null;
  const parts = token.split('.');
  if (parts.length !== 2) return null;

  const [base64Payload, signature] = parts;
  const expectedSig = crypto
    .createHmac('sha256', JWT_SECRET)
    .update(base64Payload)
    .digest('base64url');

  if (signature !== expectedSig) return null;

  try {
    const raw = Buffer.from(base64Payload, 'base64url').toString('utf-8');
    return JSON.parse(raw);
  } catch (err) {
    return null;
  }
}

