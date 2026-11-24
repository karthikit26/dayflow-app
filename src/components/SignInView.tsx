import React from 'react';

interface SignInViewProps {
  loading: boolean;
  error: string | null;
  onSignIn: () => void;
}

export const SignInView: React.FC<SignInViewProps> = ({
  loading,
  error,
  onSignIn,
}) => {
  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-50 px-4">
      <div className="w-full max-w-sm rounded-lg border border-slate-200 bg-white p-8">
        <div className="flex items-center gap-3">
          <img
            src="/assets/aistudio/Glowing_Sunrise_Waves_with_Checkmark_36f8e522.png"
            alt="DayFlow"
            className="h-10 w-10 shrink-0 rounded-xl object-cover shadow-xs"
          />
          <div>
            <h1 className="font-display text-lg font-bold tracking-tight text-slate-900">
              DayFlow
            </h1>
            <p className="text-xs text-slate-500">
              Team Work Logging & Sprint Visibility
            </p>
          </div>
        </div>

        <p className="mt-6 text-sm text-slate-600">
          Sign in with your approved Google Workspace account to continue.
        </p>

        {error && (
          <div
            role="alert"
            className="mt-4 rounded-md border border-red-200 bg-red-50 px-3.5 py-2.5 text-xs leading-relaxed text-red-800"
          >
            {error}
          </div>
        )}

        <div className="mt-6">
          <button
            type="button"
            onClick={onSignIn}
            disabled={loading}
            className="gsi-material-button w-full"
          >
            <div className="gsi-material-button-state" />
            <div className="gsi-material-button-content-wrapper">
              <div className="gsi-material-button-icon">
                <svg
                  version="1.1"
                  xmlns="http://www.w3.org/2000/svg"
                  viewBox="0 0 48 48"
                  style={{ display: 'block' }}
                >
                  <path
                    fill="#EA4335"
                    d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"
                  />
                  <path
                    fill="#4285F4"
                    d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"
                  />
                  <path
                    fill="#FBBC05"
                    d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"
                  />
                  <path
                    fill="#34A853"
                    d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"
                  />
                  <path fill="none" d="M0 0h48v48H0z" />
                </svg>
              </div>
              <span className="gsi-material-button-contents">
                {loading ? 'Signing in...' : 'Sign in with Google'}
              </span>
            </div>
          </button>
        </div>
      </div>
    </div>
  );
};
