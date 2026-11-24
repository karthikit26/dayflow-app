import React, { useMemo, useState } from 'react';
import {
  CheckCircle2,
  Edit3,
  ExternalLink,
  FolderKanban,
  Lock,
  Plus,
  Search,
  Trash2,
} from 'lucide-react';
import type {
  FieldValue,
  WorkEntry,
  WorkFieldDefinition,
} from '../types';
import {
  apiRequest,
  formatUtcInTimezone,
  isHttpUrl,
  type BootstrapPayload,
} from '../lib/api';
import { ConfirmDialog } from './ConfirmDialog';
import { DynamicWorkForm } from './DynamicWorkForm';
import { StatusText } from './StatusText';

export type MemberTab =
  | 'my-work'
  | 'my-projects'
  | 'my-history'
  | 'team-overview'
  | 'profile';

export interface MemberViewProps {
  data: BootstrapPayload;
  activeProjectId: string;
  onSelectProjectContext: (projectId: string) => void;
  selectedDate: string;
  onSelectDate: (date: string) => void;
  onRefresh: () => Promise<void>;
  onToast: (tone: 'success' | 'error' | 'info', message: string) => void;
  isPreviewMode: boolean;
}

function getFieldsForEntry(
  data: BootstrapPayload,
  entry: WorkEntry
): WorkFieldDefinition[] {
  const project = data.projects.find((p) => p.projectId === entry.projectId);
  if (project?.useProjectConfig) {
    const pv = data.projectConfigurationVersions.find(
      (v) => v.projectId === entry.projectId && v.version === entry.configVersion
    );
    if (pv) {
      return pv.configurationData.fields
        .slice()
        .sort((a, b) => a.displayOrder - b.displayOrder);
    }
  }
  const found = data.workFieldConfigurationVersions.find(
    (v) => v.version === entry.configVersion
  );
  return (found ? found.fields : data.workFieldDefinitions)
    .slice()
    .sort((a, b) => a.displayOrder - b.displayOrder);
}

function renderFieldDisplayValue(val: FieldValue | undefined): string {
  if (val === undefined || val === null || val === '') return '—';
  if (Array.isArray(val)) return val.length > 0 ? val.join(', ') : '—';
  if (typeof val === 'boolean') return val ? 'Yes' : 'No';
  return String(val);
}

// =============================================================================
// SCREEN 1: MY WORK (Project-Aware Work Logging)
// =============================================================================
export const MyWorkScreen: React.FC<MemberViewProps> = ({
  data,
  activeProjectId,
  selectedDate,
  onSelectDate,
  onRefresh,
  onToast,
  isPreviewMode,
}) => {
  const activeDate = selectedDate || data.todayInTz;

  // Preview mode keeps simulated entries strictly in local memory
  const [previewEntries, setPreviewEntries] = useState<WorkEntry[]>([]);
  const [previewSubmitted, setPreviewSubmitted] = useState(false);

  const realDayEntries = useMemo(
    () =>
      data.workEntries.filter(
        (w) =>
          w.userId === data.currentUser.userId &&
          w.workDate === activeDate &&
          (!activeProjectId || w.projectId === activeProjectId)
      ),
    [data.workEntries, data.currentUser.userId, activeDate, activeProjectId]
  );

  const dayEntries = isPreviewMode
    ? previewEntries.filter(
        (w) => !activeProjectId || w.projectId === activeProjectId
      )
    : realDayEntries;

  const totalDayEntriesCount = isPreviewMode
    ? previewEntries.length
    : data.workEntries.filter(
        (w) => w.userId === data.currentUser.userId && w.workDate === activeDate
      ).length;

  const submission = isPreviewMode
    ? previewSubmitted
      ? {
          submissionId: 'PREVIEW-SUB',
          userId: data.currentUser.userId,
          workDate: activeDate,
          entryCount: previewEntries.length,
          status: 'Submitted' as const,
          submittedBy: data.currentUser.email,
          submittedAt: new Date().toISOString(),
          correctionHistory: [],
        }
      : undefined
    : data.dailySubmissions.find(
        (s) => s.userId === data.currentUser.userId && s.workDate === activeDate
      );

  const isLocked = submission?.status === 'Submitted';

  const [showForm, setShowForm] = useState(false);
  const [editingEntry, setEditingEntry] = useState<WorkEntry | null>(null);
  const [showCompletePanel, setShowCompletePanel] = useState(false);
  const [noWorkReason, setNoWorkReason] = useState('');
  const [deleteTarget, setDeleteTarget] = useState<WorkEntry | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const projectMap = useMemo(
    () => new Map(data.projects.map((p) => [p.projectId, p.name])),
    [data.projects]
  );
  const sprintMap = useMemo(
    () => new Map(data.sprints.map((s) => [s.sprintId, s.name])),
    [data.sprints]
  );

  const handleSaveWork = async (
    projectId: string,
    fieldValues: Record<string, FieldValue>,
    relatedWorkId?: string
  ) => {
    setError(null);

    if (isPreviewMode) {
      const cfg = data.projectConfigs[projectId] || {
        version: data.systemSettings.activeConfigVersion,
        fields: data.workFieldDefinitions,
        options: data.workFieldOptions,
      };
      const summaryField = cfg.fields.find((f) => f.systemRole === 'summary');
      const catField = cfg.fields.find((f) => f.systemRole === 'category');
      const statusField = cfg.fields.find((f) => f.systemRole === 'status');
      const sprintField = cfg.fields.find((f) => f.systemRole === 'sprint');
      const adoField = cfg.fields.find((f) => f.systemRole === 'ado_ref');

      const statusVal = statusField
        ? String(fieldValues[statusField.fieldId] || 'Completed')
        : 'Completed';
      const opt = cfg.options.find(
        (o) =>
          statusField && o.fieldId === statusField.fieldId && o.value === statusVal
      );

      const nowIso = new Date().toISOString();
      const sim: WorkEntry = {
        workId: editingEntry
          ? editingEntry.workId
          : `PRV-${previewEntries.length + 1}`,
        projectId,
        userId: data.currentUser.userId,
        workDate: activeDate,
        configVersion: cfg.version,
        fieldValues,
        summary: summaryField
          ? String(fieldValues[summaryField.fieldId] || 'Preview Entry')
          : 'Preview Entry',
        category: catField
          ? String(fieldValues[catField.fieldId] || 'Development')
          : 'Development',
        status: statusVal,
        semanticStatus: opt?.semanticStatus || 'completed',
        sprintId: sprintField
          ? String(fieldValues[sprintField.fieldId] || '') || undefined
          : undefined,
        adoReference: adoField
          ? String(fieldValues[adoField.fieldId] || '') || undefined
          : undefined,
        relatedWorkId,
        createdBy: data.currentUser.email,
        createdAt: nowIso,
        updatedAt: nowIso,
      };

      setPreviewEntries((prev) =>
        editingEntry
          ? prev.map((p) => (p.workId === editingEntry.workId ? sim : p))
          : [sim, ...prev]
      );
      setShowForm(false);
      setEditingEntry(null);
      onToast(
        'info',
        'Preview Mode: Work form validated locally (not saved to production).'
      );
      return;
    }

    setBusy(true);
    try {
      if (editingEntry) {
        await apiRequest(`/api/work-entries/${editingEntry.workId}`, {
          method: 'PATCH',
          body: JSON.stringify({
            fieldValues,
            relatedWorkId: relatedWorkId || null,
          }),
        });
        onToast('success', 'Work entry updated.');
      } else {
        await apiRequest('/api/work-entries', {
          method: 'POST',
          body: JSON.stringify({
            projectId,
            workDate: activeDate,
            fieldValues,
            relatedWorkId,
          }),
        });
        onToast('success', 'Work entry saved.');
      }
      setShowForm(false);
      setEditingEntry(null);
      await onRefresh();
    } catch (err) {
      const msg =
        err instanceof Error ? err.message : 'Failed to save work entry';
      setError(msg);
      onToast('error', msg);
    } finally {
      setBusy(false);
    }
  };

  const handleDeleteEntry = async () => {
    if (!deleteTarget) return;
    if (isPreviewMode) {
      setPreviewEntries((prev) =>
        prev.filter((p) => p.workId !== deleteTarget.workId)
      );
      setDeleteTarget(null);
      onToast('info', 'Preview entry removed.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await apiRequest(`/api/work-entries/${deleteTarget.workId}`, {
        method: 'DELETE',
      });
      setDeleteTarget(null);
      onToast('success', 'Work entry deleted.');
      await onRefresh();
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to delete entry';
      setError(msg);
      onToast('error', msg);
      setDeleteTarget(null);
    } finally {
      setBusy(false);
    }
  };

  const handleCompleteDay = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (isPreviewMode) {
      const minLen = data.systemSettings.minNoWorkReasonLength || 10;
      if (totalDayEntriesCount === 0 && noWorkReason.trim().length < minLen) {
        setError(
          `Provide at least one simulated entry or a no-work reason (${minLen}+ chars).`
        );
        return;
      }
      setPreviewSubmitted(true);
      setShowCompletePanel(false);
      onToast('info', 'Preview Mode: Daily submission workflow validated.');
      return;
    }

    setBusy(true);
    try {
      await apiRequest('/api/submissions/complete-day', {
        method: 'POST',
        body: JSON.stringify({
          workDate: activeDate,
          noWorkReason: totalDayEntriesCount === 0 ? noWorkReason : '',
        }),
      });
      setShowCompletePanel(false);
      setNoWorkReason('');
      onToast('success', `Daily submission completed for ${activeDate}.`);
      await onRefresh();
    } catch (err) {
      const msg =
        err instanceof Error ? err.message : 'Complete Day validation failed';
      setError(msg);
      onToast('error', msg);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4 border-b border-slate-200 pb-5">
        <div>
          <p className="text-xs text-slate-500">
            <span className="font-mono tabular-nums">{activeDate}</span> ·{' '}
            {data.systemSettings.timezone} ·{' '}
            {activeProjectId
              ? projectMap.get(activeProjectId) || activeProjectId
              : 'All Assigned Projects'}
          </p>
          <h1 className="mt-1 font-display text-2xl font-bold tracking-tight text-slate-900">
            My Work
          </h1>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <input
            type="date"
            aria-label="Work date"
            max={data.todayInTz}
            value={activeDate}
            onChange={(e) => {
              onSelectDate(e.target.value);
              setShowForm(false);
              setEditingEntry(null);
            }}
            className="rounded-lg border border-slate-300 bg-white px-3 py-2 font-mono text-xs text-slate-800"
          />

          <button
            type="button"
            disabled={isLocked}
            onClick={() => {
              setEditingEntry(null);
              setShowForm(true);
              setShowCompletePanel(false);
              setError(null);
            }}
            className="inline-flex items-center gap-2 rounded-lg bg-blue-700 px-4 py-2 text-sm font-semibold text-white shadow-xs transition-colors hover:bg-blue-800 disabled:cursor-not-allowed disabled:opacity-50 whitespace-nowrap shrink-0"
          >
            <Plus className="h-4 w-4" />
            <span>Add Work</span>
          </button>

          {!isLocked && (
            <button
              type="button"
              onClick={() => {
                setShowCompletePanel(!showCompletePanel);
                setShowForm(false);
                setError(null);
              }}
              className="inline-flex items-center gap-2 rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-800 transition-colors hover:bg-slate-50 whitespace-nowrap shrink-0"
            >
              <CheckCircle2 className="h-4 w-4 text-emerald-700" />
              <span>Complete Day</span>
            </button>
          )}
        </div>
      </div>

      {/* Submission Status Strip */}
      <div className="flex flex-wrap items-center justify-between gap-4 rounded-xl border border-slate-200 bg-white px-5 py-3.5 text-sm shadow-xs">
        <div className="flex items-center gap-3">
          <span className="text-xs font-medium text-slate-500">
            Daily Submission Status:
          </span>
          <StatusText status={submission?.status || 'Pending'} />
          {submission?.submittedAt && (
            <span className="text-xs text-slate-500">
              Submitted{' '}
              {formatUtcInTimezone(
                submission.submittedAt,
                data.systemSettings.timezone
              )}
            </span>
          )}
        </div>
        <div className="font-mono text-xs text-slate-600 tabular-nums">
          {totalDayEntriesCount} work{' '}
          {totalDayEntriesCount === 1 ? 'entry' : 'entries'} on {activeDate}
        </div>
      </div>

      {submission?.status === 'Reopened' && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          Report reopened by {submission.reopenedBy}: {submission.reopenReason}.
          Update your entries and select Complete Day when ready.
        </div>
      )}

      {isLocked && (
        <div className="flex items-center gap-2.5 rounded-lg border border-emerald-200 bg-emerald-50/70 px-4 py-3 text-sm text-emerald-900">
          <Lock className="h-4 w-4 shrink-0 text-emerald-700" />
          <span>
            Daily report for {activeDate} is submitted and locked. Contact a
            Project Admin or Super Admin if reopening is required.
          </span>
        </div>
      )}

      {error && (
        <div
          role="alert"
          className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-xs text-red-800"
        >
          {error}
        </div>
      )}

      {showCompletePanel && !isLocked && (
        <form
          onSubmit={handleCompleteDay}
          className="rounded-xl border border-slate-300 bg-white p-6 shadow-sm space-y-4"
        >
          <h2 className="font-display text-base font-semibold text-slate-900">
            Complete Daily Submission ({activeDate})
          </h2>
          {totalDayEntriesCount > 0 ? (
            <p className="text-sm text-slate-600">
              You have {totalDayEntriesCount} recorded work{' '}
              {totalDayEntriesCount === 1 ? 'entry' : 'entries'} across your
              projects today. Submitting locks this date from further edits.
            </p>
          ) : (
            <div className="space-y-2">
              <p className="text-sm text-slate-600">
                No work entries recorded for {activeDate}. Provide a clear
                no-work reason (minimum{' '}
                {data.systemSettings.minNoWorkReasonLength} characters) to
                complete your daily submission.
              </p>
              <textarea
                rows={3}
                required
                minLength={data.systemSettings.minNoWorkReasonLength}
                value={noWorkReason}
                onChange={(e) => setNoWorkReason(e.target.value)}
                placeholder="Reason for no work entries today (e.g., approved leave, holiday, training)..."
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
              />
            </div>
          )}

          <div className="flex items-center justify-end gap-3 pt-2">
            <button
              type="button"
              onClick={() => setShowCompletePanel(false)}
              className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={busy}
              className="rounded-lg bg-emerald-700 px-4 py-2 text-xs font-semibold text-white hover:bg-emerald-800 disabled:opacity-60"
            >
              {busy ? 'Submitting...' : 'Confirm & Complete Day'}
            </button>
          </div>
        </form>
      )}

      {showForm && !isLocked && (
        <DynamicWorkForm
          projects={data.projects}
          initialProjectId={activeProjectId}
          projectConfigs={data.projectConfigs}
          fallbackFields={data.workFieldDefinitions}
          fallbackOptions={data.workFieldOptions}
          sprints={data.sprints}
          initialEntry={editingEntry}
          relatedEntries={data.workEntries.filter(
            (w) => w.userId === data.currentUser.userId
          )}
          isPreviewMode={isPreviewMode}
          busy={busy}
          error={error}
          onSubmit={handleSaveWork}
          onCancel={() => {
            setShowForm(false);
            setEditingEntry(null);
          }}
        />
      )}

      {/* Day Entries */}
      <div className="space-y-3">
        {dayEntries.length === 0 ? (
          <div className="rounded-xl border border-slate-200 bg-white p-10 text-center shadow-xs">
            <p className="text-sm font-medium text-slate-700">
              No work entries recorded for {activeDate}
              {activeProjectId
                ? ` in ${projectMap.get(activeProjectId) || activeProjectId}`
                : ''}
              .
            </p>
            <p className="mt-1 text-xs text-slate-500">
              Click “Add Work” to select a project and record activities, or use
              “Complete Day” if no work was performed.
            </p>
          </div>
        ) : (
          <div className="divide-y divide-slate-200 rounded-xl border border-slate-200 bg-white shadow-xs">
            {dayEntries.map((entry) => {
              const fields = getFieldsForEntry(data, entry);
              return (
                <div key={entry.workId} className="p-5 space-y-3">
                  <div className="flex flex-wrap items-start justify-between gap-4">
                    <div className="space-y-1 max-w-2xl">
                      <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500">
                        <span className="font-mono">{entry.workId}</span>
                        <span aria-hidden="true">·</span>
                        <span className="font-semibold text-slate-700">
                          {projectMap.get(entry.projectId) || entry.projectId}
                        </span>
                        <span aria-hidden="true">·</span>
                        <span>{entry.category}</span>
                        {entry.sprintId && (
                          <>
                            <span aria-hidden="true">·</span>
                            <span>
                              {sprintMap.get(entry.sprintId) || entry.sprintId}
                            </span>
                          </>
                        )}
                        {entry.adoReference && (
                          <>
                            <span aria-hidden="true">·</span>
                            {isHttpUrl(entry.adoReference) ? (
                              <a
                                href={entry.adoReference}
                                target="_blank"
                                rel="noreferrer"
                                className="inline-flex items-center gap-1 font-mono text-blue-700 hover:underline"
                              >
                                <span>ADO Link</span>
                                <ExternalLink className="h-3 w-3" />
                              </a>
                            ) : (
                              <span className="font-mono text-slate-700">
                                {entry.adoReference}
                              </span>
                            )}
                          </>
                        )}
                      </div>
                      <p className="text-sm font-medium text-slate-900">
                        {entry.summary}
                      </p>
                    </div>

                    <div className="flex items-center gap-3 shrink-0">
                      <StatusText status={entry.status} />
                      {!isLocked && (
                        <div className="flex items-center gap-1">
                          <button
                            type="button"
                            onClick={() => {
                              setEditingEntry(entry);
                              setShowForm(true);
                              setShowCompletePanel(false);
                            }}
                            className="rounded p-1.5 text-slate-500 hover:bg-slate-100 hover:text-slate-900"
                            title="Edit entry"
                          >
                            <Edit3 className="h-4 w-4" />
                          </button>
                          {(data.systemSettings.allowMemberEntryDeletion ||
                            isPreviewMode) && (
                            <button
                              type="button"
                              onClick={() => setDeleteTarget(entry)}
                              className="rounded p-1.5 text-slate-500 hover:bg-red-50 hover:text-red-700"
                              title="Delete entry"
                            >
                              <Trash2 className="h-4 w-4" />
                            </button>
                          )}
                        </div>
                      )}
                    </div>
                  </div>

                  <div className="grid gap-x-6 gap-y-2 border-t border-slate-100 pt-3 text-xs sm:grid-cols-2 lg:grid-cols-3">
                    {fields
                      .filter(
                        (f) =>
                          f.systemRole !== 'summary' &&
                          f.systemRole !== 'category' &&
                          f.systemRole !== 'status' &&
                          f.systemRole !== 'sprint' &&
                          f.systemRole !== 'ado_ref' &&
                          entry.fieldValues[f.fieldId] !== undefined &&
                          entry.fieldValues[f.fieldId] !== ''
                      )
                      .map((f) => (
                        <div key={f.fieldId}>
                          <span className="font-medium text-slate-500">
                            {f.label}:{' '}
                          </span>
                          <span className="text-slate-800">
                            {renderFieldDisplayValue(
                              entry.fieldValues[f.fieldId]
                            )}
                          </span>
                        </div>
                      ))}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      <ConfirmDialog
        open={!!deleteTarget}
        title="Delete Work Entry"
        description={`Remove "${deleteTarget?.summary}" (${deleteTarget?.workId}) from ${activeDate}?`}
        confirmLabel="Delete"
        tone="danger"
        busy={busy}
        onConfirm={handleDeleteEntry}
        onCancel={() => setDeleteTarget(null)}
      />
    </div>
  );
};

// =============================================================================
// SCREEN 3: MY HISTORY (Project-Aware)
// =============================================================================
export const MyHistoryScreen: React.FC<MemberViewProps> = ({
  data,
  activeProjectId,
}) => {
  const [search, setSearch] = useState('');
  const [dateFilter, setDateFilter] = useState('');
  const [projectFilter, setProjectFilter] = useState(activeProjectId);

  const projectMap = useMemo(
    () => new Map(data.projects.map((p) => [p.projectId, p.name])),
    [data.projects]
  );

  const myEntries = data.workEntries.filter(
    (w) => w.userId === data.currentUser.userId
  );
  const subMap = new Map(
    data.dailySubmissions
      .filter((s) => s.userId === data.currentUser.userId)
      .map((s) => [s.workDate, s])
  );

  const filtered = myEntries.filter((w) => {
    if (projectFilter && w.projectId !== projectFilter) return false;
    if (dateFilter && w.workDate !== dateFilter) return false;
    if (search) {
      const q = search.toLowerCase();
      const match =
        w.summary.toLowerCase().includes(q) ||
        w.category.toLowerCase().includes(q) ||
        (w.adoReference || '').toLowerCase().includes(q) ||
        Object.values(w.fieldValues).some((v) =>
          String(v).toLowerCase().includes(q)
        );
      if (!match) return false;
    }
    return true;
  });

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4 border-b border-slate-200 pb-5">
        <div>
          <h1 className="font-display text-2xl font-bold tracking-tight text-slate-900">
            My History
          </h1>
          <p className="mt-1 text-sm text-slate-600">
            Historical work entries preserving original project associations,
            field configuration snapshots, ADO references, and submission states.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2.5">
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-2.5 h-3.5 w-3.5 text-slate-400" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search work or ADO ref..."
              className="rounded-lg border border-slate-300 bg-white pl-8 pr-3 py-1.5 text-xs"
            />
          </div>
          <select
            aria-label="Filter history by project"
            value={projectFilter}
            onChange={(e) => setProjectFilter(e.target.value)}
            className="rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-xs"
          >
            <option value="">All Projects</option>
            {data.projects.map((p) => (
              <option key={p.projectId} value={p.projectId}>
                {p.name}
              </option>
            ))}
          </select>
          <input
            type="date"
            value={dateFilter}
            onChange={(e) => setDateFilter(e.target.value)}
            className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 font-mono text-xs"
          />
          {dateFilter && (
            <button
              type="button"
              onClick={() => setDateFilter('')}
              className="text-xs font-medium text-blue-700 hover:underline"
            >
              Clear date
            </button>
          )}
        </div>
      </div>

      <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-xs">
        {filtered.length === 0 ? (
          <div className="p-10 text-center text-sm text-slate-500">
            No historical work entries match your filter.
          </div>
        ) : (
          <table className="w-full text-left text-sm">
            <thead className="border-b border-slate-200 bg-slate-50 text-xs text-slate-500">
              <tr>
                <th className="px-4 py-3 font-medium">Work Date</th>
                <th className="px-4 py-3 font-medium">Project</th>
                <th className="px-4 py-3 font-medium">Work Summary & Fields</th>
                <th className="px-4 py-3 font-medium">Work Status</th>
                <th className="px-4 py-3 font-medium">ADO Reference</th>
                <th className="px-4 py-3 font-medium">Day Submission</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {filtered.map((entry) => {
                const sub = subMap.get(entry.workDate);
                const fields = getFieldsForEntry(data, entry);
                return (
                  <tr key={entry.workId} className="hover:bg-slate-50 align-top">
                    <td className="px-4 py-3 font-mono text-xs text-slate-700 tabular-nums whitespace-nowrap">
                      {entry.workDate}
                      <div className="text-[11px] text-slate-400">
                        v{entry.configVersion}
                      </div>
                    </td>
                    <td className="px-4 py-3 text-xs font-medium text-slate-800 whitespace-nowrap">
                      {projectMap.get(entry.projectId) || entry.projectId}
                    </td>
                    <td className="px-4 py-3 max-w-md space-y-1">
                      <div className="font-medium text-slate-900">
                        {entry.summary}
                      </div>
                      <div className="text-xs text-slate-500">
                        {entry.category}
                      </div>
                      <div className="space-y-0.5 text-xs text-slate-600">
                        {fields
                          .filter(
                            (f) =>
                              f.systemRole !== 'summary' &&
                              f.systemRole !== 'category' &&
                              f.systemRole !== 'status' &&
                              f.systemRole !== 'ado_ref' &&
                              entry.fieldValues[f.fieldId] !== undefined &&
                              entry.fieldValues[f.fieldId] !== ''
                          )
                          .map((f) => (
                            <div key={f.fieldId}>
                              <span className="text-slate-400">
                                {f.label}:{' '}
                              </span>
                              <span>
                                {renderFieldDisplayValue(
                                  entry.fieldValues[f.fieldId]
                                )}
                              </span>
                            </div>
                          ))}
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <StatusText status={entry.status} />
                    </td>
                    <td className="px-4 py-3 text-xs whitespace-nowrap">
                      {entry.adoReference ? (
                        isHttpUrl(entry.adoReference) ? (
                          <a
                            href={entry.adoReference}
                            target="_blank"
                            rel="noreferrer"
                            className="inline-flex items-center gap-1 font-mono text-blue-700 hover:underline"
                          >
                            <span>Open ADO</span>
                            <ExternalLink className="h-3 w-3" />
                          </a>
                        ) : (
                          <span className="font-mono text-slate-700">
                            {entry.adoReference}
                          </span>
                        )
                      ) : (
                        <span className="text-slate-400">—</span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <StatusText status={sub?.status || 'Pending'} />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
};

// =============================================================================
// SCREEN 4: TEAM OVERVIEW (Within Assigned Projects)
// =============================================================================
export const TeamOverviewScreen: React.FC<MemberViewProps> = ({
  data,
  activeProjectId,
}) => {
  const projectMap = useMemo(
    () => new Map(data.projects.map((p) => [p.projectId, p.name])),
    [data.projects]
  );
  const sprintMap = useMemo(
    () => new Map(data.sprints.map((s) => [s.sprintId, s.name])),
    [data.sprints]
  );

  return (
    <div className="space-y-6">
      <div className="border-b border-slate-200 pb-5">
        <p className="text-xs text-slate-500">
          <span className="font-mono tabular-nums">{data.todayInTz}</span> ·{' '}
          {data.systemSettings.timezone} ·{' '}
          {activeProjectId
            ? projectMap.get(activeProjectId) || activeProjectId
            : 'Assigned Projects'}
        </p>
        <h1 className="mt-1 font-display text-2xl font-bold tracking-tight text-slate-900">
          Team Overview
        </h1>
        <p className="mt-1 text-sm text-slate-600">
          Daily activity and submission readiness across teammates within your
          assigned projects.
        </p>
      </div>

      <div className="divide-y divide-slate-200 rounded-xl border border-slate-200 bg-white shadow-xs">
        {data.teamDailyOverview.length === 0 ? (
          <div className="p-8 text-center text-sm text-slate-500">
            No teammates found in your assigned projects.
          </div>
        ) : (
          data.teamDailyOverview.map((member) => {
            const visibleSummaries = activeProjectId
              ? member.recentSummariesToday.filter(
                  (s) => s.projectId === activeProjectId
                )
              : member.recentSummariesToday;

            return (
              <div key={member.userId} className="p-5 space-y-3">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <span className="font-display text-sm font-semibold text-slate-900">
                      {member.name}
                    </span>
                    <span className="ml-2 text-xs text-slate-500">
                      {visibleSummaries.length} work{' '}
                      {visibleSummaries.length === 1 ? 'entry' : 'entries'} today
                    </span>
                  </div>
                  <StatusText status={member.submissionStatusToday} />
                </div>

                {visibleSummaries.length > 0 && (
                  <ul className="space-y-1.5 border-t border-slate-100 pt-3">
                    {visibleSummaries.map((item) => (
                      <li
                        key={item.workId}
                        className="flex flex-wrap items-center justify-between gap-3 text-xs"
                      >
                        <div className="text-slate-800">
                          <span>{item.summary}</span>
                          <span className="ml-2 text-slate-400">
                            {projectMap.get(item.projectId) || item.projectId} ·{' '}
                            {item.category}
                            {item.sprintId
                              ? ` · ${sprintMap.get(item.sprintId) || item.sprintId}`
                              : ''}
                          </span>
                        </div>
                        <StatusText status={item.status} />
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            );
          })
        )}
      </div>
    </div>
  );
};

// =============================================================================
// SCREEN 5: PROFILE (Includes Global Role + Project Assignments)
// =============================================================================
export const MemberProfileScreen: React.FC<MemberViewProps> = ({ data }) => {
  const { currentUser, systemSettings } = data;
  return (
    <div className="space-y-6">
      <div className="border-b border-slate-200 pb-5">
        <h1 className="font-display text-2xl font-bold tracking-tight text-slate-900">
          Profile
        </h1>
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-xs">
          <h2 className="font-display text-sm font-semibold text-slate-900">
            Account & Global Role
          </h2>
          <dl className="mt-4 grid grid-cols-1 gap-5 sm:grid-cols-2 text-sm">
            <div>
              <dt className="text-xs text-slate-500">Name</dt>
              <dd className="mt-1 font-medium text-slate-900">
                {currentUser.name}
              </dd>
            </div>
            <div>
              <dt className="text-xs text-slate-500">Email</dt>
              <dd className="mt-1 font-mono text-xs text-slate-800">
                {currentUser.email}
              </dd>
            </div>
            <div>
              <dt className="text-xs text-slate-500">Global Role</dt>
              <dd className="mt-1 font-mono text-xs font-semibold text-slate-900">
                {currentUser.role}
              </dd>
            </div>
            <div>
              <dt className="text-xs text-slate-500">Account Status</dt>
              <dd className="mt-1">
                <StatusText status={currentUser.status} />
              </dd>
            </div>
            <div className="sm:col-span-2">
              <dt className="text-xs text-slate-500">Company Timezone</dt>
              <dd className="mt-1 font-mono text-xs text-slate-800">
                {systemSettings.timezone} ({data.todayInTz} · {data.timeInTz})
              </dd>
            </div>
          </dl>
        </div>

        <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-xs space-y-4">
          <div className="flex items-center gap-2">
            <FolderKanban className="h-4 w-4 text-slate-500" />
            <h2 className="font-display text-sm font-semibold text-slate-900">
              Assigned Projects ({data.projects.length})
            </h2>
          </div>
          {data.projects.length === 0 ? (
            <p className="text-xs text-slate-500">
              No projects assigned yet.
            </p>
          ) : (
            <div className="divide-y divide-slate-100 text-xs">
              {data.projects.map((p) => (
                <div
                  key={p.projectId}
                  className="flex items-center justify-between py-2.5"
                >
                  <div>
                    <p className="font-semibold text-slate-900">{p.name}</p>
                    <p className="font-mono text-[11px] text-slate-400">
                      {p.projectId} · Role: {p.callerProjectRole || 'SUPER_ADMIN'}
                    </p>
                  </div>
                  <StatusText status={p.status} />
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
