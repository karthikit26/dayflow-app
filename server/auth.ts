import fs from 'node:fs';
import path from 'node:path';
import type { NextFunction, Request, Response } from 'express';
import { createRemoteJWKSet, jwtVerify } from 'jose';
import type { UserRecord } from '../src/types';
import { repository } from './store';
import { isPersonalEmailDomain } from './validators';

interface FirebaseConfig {
  projectId: string;
}

function loadFirebaseProjectId(): string {
  const configPath = path.resolve(process.cwd(), 'firebase-applet-config.json');
  const raw = fs.readFileSync(configPath, 'utf8');
  const parsed = JSON.parse(raw) as FirebaseConfig;
  if (!parsed.projectId) {
    throw new Error('firebase-applet-config.json missing projectId');
  }
  return parsed.projectId;
}

const PROJECT_ID = loadFirebaseProjectId();
const JWKS = createRemoteJWKSet(
  new URL(
    'https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com'
  )
);

export interface AuthenticatedRequest extends Request {
  authMember?: UserRecord;
  googleAccessToken?: string;
}

const recentSignInLog = new Map<string, number>();

export async function verifyFirebaseIdToken(idToken: string): Promise<{
  email: string;
  name: string;
  picture?: string;
  emailVerified: boolean;
}> {
  const { payload } = await jwtVerify(idToken, JWKS, {
    issuer: `https://securetoken.google.com/${PROJECT_ID}`,
    audience: PROJECT_ID,
  });

  const email =
    typeof payload.email === 'string' ? payload.email.toLowerCase() : '';
  const emailVerified = payload.email_verified === true;
  const name =
    typeof payload.name === 'string' && payload.name.trim()
      ? payload.name.trim()
      : email.split('@')[0] || 'Team Member';
  const picture =
    typeof payload.picture === 'string' ? payload.picture : undefined;

  if (!email) {
    throw new Error('Token missing email claim');
  }
  return { email, name, picture, emailVerified };
}

export async function requireAuth(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      res.status(401).json({ error: 'Authentication required' });
      return;
    }

    const idToken = authHeader.slice('Bearer '.length).trim();
    if (!idToken) {
      res.status(401).json({ error: 'Missing bearer token' });
      return;
    }

    const verified = await verifyFirebaseIdToken(idToken);
    if (!verified.emailVerified) {
      res
        .status(403)
        .json({ error: 'Verified Google Workspace email is required.' });
      return;
    }

    const googleTokenHeader = req.headers['x-google-access-token'];
    if (typeof googleTokenHeader === 'string' && googleTokenHeader.trim()) {
      req.googleAccessToken = googleTokenHeader.trim();
    }

    type AuthResolveResult =
      | { errorStatus: number; errorMessage: string }
      | { user: UserRecord };

    const result = await repository.mutate<AuthResolveResult>((draft) => {
      const domain = verified.email.split('@')[1] || '';
      const hasAnySuperAdmin = draft.users.some(
        (u) => u.role === 'SUPER_ADMIN' && u.status === 'Active'
      );
      let found = draft.users.find(
        (u) => u.email.toLowerCase() === verified.email
      );
      const nowIso = new Date().toISOString();

      // Also check if user has a valid non-expired pending project invitation
      const hasValidPendingInvite = draft.projectInvitations.some(
        (inv) =>
          inv.inviteeEmail.toLowerCase() === verified.email &&
          inv.invitationStatus === 'Pending' &&
          inv.expiresAt > nowIso
      );

      // Check domain restrictions (except initial Super Admin bootstrap, registered users, or explicitly invited users)
      if (!found && hasAnySuperAdmin && !hasValidPendingInvite) {
        if (
          draft.systemSettings.blockPersonalDomains &&
          isPersonalEmailDomain(verified.email) &&
          !draft.systemSettings.allowedDomains.includes(domain)
        ) {
          return {
            errorStatus: 403,
            errorMessage:
              'Personal email accounts are not permitted unless explicitly invited or approved by an administrator.',
          };
        }

        if (draft.systemSettings.allowedDomains.length === 0) {
          return {
            errorStatus: 403,
            errorMessage:
              'Your account is not registered in DayFlow. Ask a Super Admin or Admin to invite your email or configure approved company domains.',
          };
        }

        if (!draft.systemSettings.allowedDomains.includes(domain)) {
          return {
            errorStatus: 403,
            errorMessage: `Domain "${domain}" is not an approved company email domain.`,
          };
        }
      }

      if (!found) {
        const nextNum = draft.users.length + 1;
        const userId = `USR-${String(nextNum).padStart(3, '0')}`;
        found = {
          userId,
          email: verified.email,
          name: verified.name,
          avatarUrl: verified.picture,
          role: hasAnySuperAdmin ? 'MEMBER' : 'SUPER_ADMIN',
          status: 'Active',
          createdAt: nowIso,
          updatedAt: nowIso,
        };
        draft.users.push(found);

        draft.auditLogs.unshift({
          auditId: `AUD-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
          actorId: found.userId,
          actorEmail: found.email,
          actorRole: found.role,
          action: hasAnySuperAdmin
            ? hasValidPendingInvite
              ? 'USER_PROVISIONED_FROM_INVITATION'
              : 'MEMBER_DOMAIN_PROVISIONED'
            : 'INITIAL_SUPER_ADMIN_PROVISIONED',
          entityType: 'User',
          entityId: found.userId,
          newValue: { email: found.email, role: found.role },
          timestamp: nowIso,
        });
      } else {
        if (found.status !== 'Active') {
          return {
            errorStatus: 403,
            errorMessage:
              'Your account has been deactivated. Contact a Super Admin.',
          };
        }
        if (
          draft.systemSettings.allowedDomains.length > 0 &&
          !draft.systemSettings.allowedDomains.includes(domain) &&
          found.role === 'MEMBER' &&
          !hasValidPendingInvite
        ) {
          return {
            errorStatus: 403,
            errorMessage: `Domain "${domain}" is not permitted.`,
          };
        }
        if (verified.picture && found.avatarUrl !== verified.picture) {
          found.avatarUrl = verified.picture;
          found.updatedAt = nowIso;
        }
      }

      const lastSignIn = recentSignInLog.get(found.email) || 0;
      if (Date.now() - lastSignIn > 30 * 60 * 1000) {
        recentSignInLog.set(found.email, Date.now());
        draft.auditLogs.unshift({
          auditId: `AUD-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
          actorId: found.userId,
          actorEmail: found.email,
          actorRole: found.role,
          action: 'USER_SIGNIN',
          entityType: 'Auth',
          entityId: found.userId,
          newValue: { email: found.email, role: found.role },
          timestamp: nowIso,
        });
      }

      return { user: found };
    });

    if ('errorStatus' in result) {
      res.status(result.errorStatus).json({ error: result.errorMessage });
      return;
    }

    req.authMember = result.user;
    next();
  } catch (err) {
    console.error('Auth verification error:', err);
    res.status(401).json({ error: 'Invalid or expired authentication token' });
  }
}

export function requireSuperAdmin(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
): void {
  if (!req.authMember) {
    res.status(401).json({ error: 'Authentication required' });
    return;
  }
  if (req.authMember.role !== 'SUPER_ADMIN') {
    res.status(403).json({ error: 'Super Admin privileges required' });
    return;
  }
  next();
}

export function requireAdminOrSuperAdmin(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
): void {
  if (!req.authMember) {
    res.status(401).json({ error: 'Authentication required' });
    return;
  }
  if (req.authMember.role !== 'SUPER_ADMIN' && req.authMember.role !== 'ADMIN') {
    res
      .status(403)
      .json({ error: 'Admin or Super Admin privileges required' });
    return;
  }
  next();
}
