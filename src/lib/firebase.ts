import { initializeApp, getApps, getApp } from 'firebase/app';
import {
  getAuth,
  GoogleAuthProvider,
  onAuthStateChanged,
  signInWithPopup,
  signOut,
  type User,
} from 'firebase/auth';
import firebaseConfig from '../../firebase-applet-config.json';

const app = getApps().length > 0 ? getApp() : initializeApp(firebaseConfig);
const auth = getAuth(app);

export const WORKSPACE_SCOPES = [
  'https://www.googleapis.com/auth/spreadsheets',
] as const;

// Basic sign-in provider: requests identity only so regular users are not blocked
// by sensitive Google Sheets OAuth scopes during app sign-in.
const loginProvider = new GoogleAuthProvider();
loginProvider.setCustomParameters({
  prompt: 'select_account',
});

// Workspace provider: requests Google Sheets scope only when a Super Admin connects/syncs Sheets.
const workspaceProvider = new GoogleAuthProvider();
for (const scope of WORKSPACE_SCOPES) {
  workspaceProvider.addScope(scope);
}
workspaceProvider.setCustomParameters({
  prompt: 'consent select_account',
});

// Keep Sheets OAuth access token strictly in JS memory (never localStorage/sessionStorage)
let cachedAccessToken: string | null = null;
let isSigningIn = false;

export function formatGoogleAuthError(err: unknown): string {
  const code =
    typeof err === 'object' &&
    err !== null &&
    'code' in err &&
    typeof (err as { code?: unknown }).code === 'string'
      ? (err as { code: string }).code
      : '';

  if (code === 'auth/popup-closed-by-user' || code === 'auth/cancelled-popup-request') {
    return 'Sign-in was cancelled before completing. If Google displayed "Access blocked (Error 403)", add your email under Google Cloud OAuth Consent Screen → Test users (or publish the OAuth app).';
  }
  if (code === 'auth/popup-blocked') {
    return 'Your browser blocked the Google sign-in popup. Allow popups for this site and try again.';
  }
  if (code === 'auth/unauthorized-domain') {
    return 'This preview domain is not listed under Firebase Authentication → Settings → Authorized domains.';
  }
  return err instanceof Error ? err.message : 'Google Workspace sign-in failed.';
}

export function initAuthListener(
  onUserChanged: (user: User | null, accessToken: string | null) => void
): () => void {
  return onAuthStateChanged(auth, (user) => {
    if (!user) {
      cachedAccessToken = null;
      onUserChanged(null, null);
      return;
    }
    if (!isSigningIn) {
      onUserChanged(user, cachedAccessToken);
    }
  });
}

export async function signInWithGoogleWorkspace(): Promise<{
  user: User;
  accessToken: string | null;
}> {
  isSigningIn = true;
  try {
    const result = await signInWithPopup(auth, loginProvider);
    // Reset Sheets token on fresh basic sign-in; Sheets scope is requested on-demand in Settings.
    cachedAccessToken = null;
    return {
      user: result.user,
      accessToken: null,
    };
  } finally {
    isSigningIn = false;
  }
}

export async function reauthorizeWorkspaceScopes(): Promise<{
  user: User;
  accessToken: string | null;
}> {
  isSigningIn = true;
  try {
    const result = await signInWithPopup(auth, workspaceProvider);
    const credential = GoogleAuthProvider.credentialFromResult(result);
    cachedAccessToken = credential?.accessToken ?? null;
    return {
      user: result.user,
      accessToken: cachedAccessToken,
    };
  } finally {
    isSigningIn = false;
  }
}

export function getInMemoryAccessToken(): string | null {
  return cachedAccessToken;
}

export async function getFreshIdToken(): Promise<string | null> {
  const user = auth.currentUser;
  if (!user) return null;
  return user.getIdToken();
}

export async function logoutWorkspace(): Promise<void> {
  cachedAccessToken = null;
  await signOut(auth);
}
