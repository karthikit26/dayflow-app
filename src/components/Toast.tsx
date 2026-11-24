import React from 'react';
import { AlertCircle, CheckCircle2, Info, X } from 'lucide-react';

export interface ToastItem {
  id: string;
  tone: 'success' | 'error' | 'info';
  message: string;
}

interface ToastViewportProps {
  toasts: ToastItem[];
  onDismiss: (id: string) => void;
}

export const ToastViewport: React.FC<ToastViewportProps> = ({
  toasts,
  onDismiss,
}) => {
  if (toasts.length === 0) return null;

  return (
    <div
      className="pointer-events-none fixed bottom-5 right-5 z-50 flex w-full max-w-sm flex-col gap-2 px-4 sm:px-0"
      aria-live="polite"
    >
      {toasts.map((t) => {
        const Icon =
          t.tone === 'success'
            ? CheckCircle2
            : t.tone === 'error'
            ? AlertCircle
            : Info;
        const styleClass =
          t.tone === 'success'
            ? 'border-emerald-200 bg-white text-emerald-950 shadow-lg'
            : t.tone === 'error'
            ? 'border-red-200 bg-white text-red-950 shadow-lg'
            : 'border-slate-200 bg-white text-slate-900 shadow-lg';
        const iconClass =
          t.tone === 'success'
            ? 'text-emerald-600'
            : t.tone === 'error'
            ? 'text-red-600'
            : 'text-blue-600';

        return (
          <div
            key={t.id}
            role={t.tone === 'error' ? 'alert' : 'status'}
            className={`pointer-events-auto flex items-start gap-3 rounded-lg border px-4 py-3 text-xs leading-relaxed transition-all duration-200 ${styleClass}`}
          >
            <Icon className={`mt-0.5 h-4 w-4 shrink-0 ${iconClass}`} aria-hidden="true" />
            <p className="flex-1 font-medium">{t.message}</p>
            <button
              type="button"
              onClick={() => onDismiss(t.id)}
              className="rounded p-0.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
              aria-label="Dismiss notification"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        );
      })}
    </div>
  );
};
