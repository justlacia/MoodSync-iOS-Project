import crypto from 'crypto';
import { NextFunction, Request, Response } from 'express';
import jwt from 'jsonwebtoken';
import { config } from './config';
import { resolveRole } from './db';
import { UserRecord } from './types';

export interface AuthenticatedRequest extends Request {
  authUser?: UserRecord;
}

export function signAuthToken(user: UserRecord): string {
  return jwt.sign(
    {
      sub: user.id,
      username: user.username,
      displayName: user.displayName,
      role: resolveRole(user.username, user.role),
    },
    config.jwtSecret,
    { expiresIn: '60d' }
  );
}

export function hashBiometricToken(token: string): string {
  return crypto.createHash('sha256').update(`moodsync_bio_v1::${token}`).digest('hex');
}

export function requireAuth(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
): void {
  const header = String(req.headers.authorization || '');
  const token = header.startsWith('Bearer ') ? header.slice(7).trim() : '';
  if (!token) {
    res.status(401).json({ error: 'Oturum gerekli. Lütfen tekrar giriş yapın.' });
    return;
  }

  try {
    const decoded = jwt.verify(token, config.jwtSecret) as {
      sub: number | string;
      username: string;
      displayName: string;
      role: string;
    };
    const id = Number(decoded.sub);
    if (!Number.isFinite(id) || id <= 0) {
      res.status(401).json({ error: 'Geçersiz oturum belirteci.' });
      return;
    }
    req.authUser = {
      id,
      username: String(decoded.username),
      displayName: String(decoded.displayName || decoded.username),
      role: resolveRole(String(decoded.username), decoded.role),
      createdAt: '',
    };
    next();
  } catch {
    res.status(401).json({ error: 'Oturum süresi doldu veya geçersiz.' });
  }
}

export function requireAdmin(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
): void {
  if (!req.authUser || resolveRole(req.authUser.username, req.authUser.role) !== 'admin') {
    res.status(403).json({ error: 'Bu işlem için admin yetkisi gerekir.' });
    return;
  }
  next();
}
