import React, { useState } from 'react';
import { Check, Copy, FileText } from 'lucide-react';
import type { ProjectSummary } from '../types';
import { apiRequest, getWeekBounds } from '../lib/api';

interface WeeklySummaryPanelProps {
  todayInTz: string;
  projects?: ProjectSummary[];
  selectedProjectId?: string;
}

interface SummaryApiResponse {
  empty: boolean;
  completedCount: number;
  inProgressCount: number;
  text: string;
  message?: string;
}

function shiftDate(dateStr: string, days: number): string {
  const [y, m, d] = dateStr.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}

export const WeeklySummaryPanel: React.FC<WeeklySummaryPanelProps> = ({
  todayInTz,
  projects = [],
  selectedProjectId = '',
}) => {
  const defaultBounds = getWeekBounds(todayInTz);
  const [weekStart, setWeekStart] = useState(defaultBounds.weekStart);
  const [weekEnd, setWeekEnd] = useState(defaultBounds.weekEnd);
  const [scopeProjectId, setScopeProjectId] = useState(selectedProjectId);
  const [generatedText, setGeneratedText] = useState('');
  const [showPreview, setShowPreview] = useState(false);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [busy, setBusy] = useState(false);

  const manageableProjects = projects.filter((p) => p.canManage);

  const handleGenerateAndCopy = async () => {
    setBusy(true);
    setStatusMessage(null);
    setErrorMessage(null);
    setCopied(false);

    try {
      const res = await apiRequest<SummaryApiResponse>(
        '/api/reports/weekly-summary',
        {
          method: 'POST',
          body: JSON.stringify({
            weekStart,
            weekEnd,
            projectId: scopeProjectId || undefined,
          }),
        }
      );

      if (res.empty) {
        setGeneratedText('');
        setShowPreview(false);
        setStatusMessage(
          res.message ||
            'No completed or in-progress work available for the selected week.'
        );
        return;
      }

      setGeneratedText(res.text);
      setShowPreview(true);

      try {
        await navigator.clipboard.writeText(res.text);
        setCopied(true);
        setStatusMessage('Weekly summary copied successfully.');
      } catch {
        setStatusMessage(
          'Summary generated below. Automatic clipboard access was blocked — copy from the preview box.'
        );
      }
    } catch (err) {
      setErrorMessage(
        err instanceof Error ? err.message : 'Failed to generate weekly summary'
      );
    } finally {
      setBusy(false);
    }
  };

  const handleCopyEdited = async () => {
    if (!generatedText.trim()) return;
    setErrorMessage(null);
    try {
      await navigator.clipboard.writeText(generatedText);
      setCopied(true);
      setStatusMessage('Weekly summary copied successfully.');
    } catch {
      setErrorMessage(
        'Clipboard access denied. Select the text below and copy manually.'
      );
    }
  };

  return (
    <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-xs space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h2 className="font-display text-base font-semibold text-slate-900">
            One-Click Weekly Team Update
          </h2>
          <p className="mt-0.5 text-xs text-slate-600">
            Generates a clean two-section update (Work Completed and Work In Progress)
            from submitted reports without names, dates, or hours.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {manageableProjects.length > 0 && (
            <select
              aria-label="Weekly summary project scope"
              value={scopeProjectId}
              onChange={(e) => setScopeProjectId(e.target.value)}
              className="rounded-md border border-slate-300 bg-white px-2.5 py-1.5 text-xs text-slate-800"
            >
              <option value="">All Managed Projects</option>
              {manageableProjects.map((p) => (
                <option key={p.projectId} value={p.projectId}>
                  {p.name}
                </option>
              ))}
            </select>
          )}
          <button
            type="button"
            onClick={() => {
              const prevStart = shiftDate(weekStart, -7);
              setWeekStart(prevStart);
              setWeekEnd(shiftDate(prevStart, 6));
            }}
            className="rounded-md border border-slate-300 bg-white px-2.5 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 whitespace-nowrap"
          >
            Prev Week
          </button>
          <input
            type="date"
            aria-label="Reporting week start"
            value={weekStart}
            onChange={(e) => {
              const b = getWeekBounds(e.target.value);
              setWeekStart(b.weekStart);
              setWeekEnd(b.weekEnd);
            }}
            className="rounded-md border border-slate-300 px-2.5 py-1.5 font-mono text-xs"
          />
          <span className="text-xs text-slate-400">to</span>
          <input
            type="date"
            aria-label="Reporting week end"
            value={weekEnd}
            onChange={(e) => setWeekEnd(e.target.value)}
            className="rounded-md border border-slate-300 px-2.5 py-1.5 font-mono text-xs"
          />
          <button
            type="button"
            disabled={busy}
            onClick={handleGenerateAndCopy}
            className="inline-flex items-center gap-2 rounded-md bg-blue-700 px-4 py-2 text-xs font-semibold text-white transition-colors hover:bg-blue-800 disabled:opacity-60 whitespace-nowrap shrink-0"
          >
            {copied ? (
              <Check className="h-3.5 w-3.5" />
            ) : (
              <Copy className="h-3.5 w-3.5" />
            )}
            <span>{busy ? 'Generating...' : 'Copy Weekly Summary'}</span>
          </button>
        </div>
      </div>

      {statusMessage && (
        <div
          role="status"
          className="rounded-md border border-emerald-200 bg-emerald-50 px-3.5 py-2 text-xs font-medium text-emerald-900"
        >
          {statusMessage}
        </div>
      )}

      {errorMessage && (
        <div
          role="alert"
          className="rounded-md border border-red-200 bg-red-50 px-3.5 py-2 text-xs text-red-800"
        >
          {errorMessage}
        </div>
      )}

      {showPreview && generatedText && (
        <div className="space-y-2 border-t border-slate-100 pt-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-1.5 text-xs font-medium text-slate-700">
              <FileText className="h-3.5 w-3.5 text-slate-500" />
              <span>
                Preview & Minor Wording Adjustment (does not alter saved work entries)
              </span>
            </div>
            <button
              type="button"
              onClick={handleCopyEdited}
              className="text-xs font-medium text-blue-700 hover:underline"
            >
              Copy Preview Text
            </button>
          </div>
          <textarea
            rows={10}
            value={generatedText}
            onChange={(e) => {
              setGeneratedText(e.target.value);
              setCopied(false);
            }}
            className="w-full rounded-md border border-slate-300 bg-slate-50 p-3 font-sans text-sm leading-relaxed text-slate-900 focus:border-blue-600 focus:bg-white focus:outline-none"
          />
        </div>
      )}
    </section>
  );
};
