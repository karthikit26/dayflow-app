import React, { useEffect, useMemo, useState } from 'react';
import {
  Edit3,
  ExternalLink,
  FolderKanban,
  History,
  Plus,
  RotateCcw,
  Search,
  ShieldAlert,
  UserPlus,
  X,
} from 'lucide-react';
import {
  SPRINT_STATUSES,
  type FieldValue,
  type ProjectRole,
  type SprintOverviewSummary,
  type SprintStatus,
  type UserRecord,
  type UserRole,
  type WorkEntry,
  type WorkFieldDefinition,
} from '../types';
import {
  apiRequest,
  formatUtcInTimezone,
  isHttpUrl,
  type BootstrapPayload,
} from '../lib/api';
import { ConfirmDialog } from './ConfirmDialog';
import { StatusText } from './StatusText';
import { WeeklySummaryPanel } from './WeeklySummaryPanel';

export interface AdminViewProps {
  data: BootstrapPayload;
  activeProjectId: string;
  onSelectProjectContext: (projectId: string) => void;
  onRefresh: () => Promise<void>;
  onToast: (tone: 'success' | 'error' | 'info', message: string) => void;
  onNavigate?: (tab: string) => void;
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

function renderDynamicValue(val: FieldValue | undefined): string {
  if (val === undefined || val === null || val === '') return '—';
  if (Array.isArray(val)) return val.length > 0 ? val.join(', ') : '—';
  if (typeof val === 'boolean') return val ? 'Yes' : 'No';
  return String(val);
}

// =============================================================================
// 1. OVERVIEW (SUPER_ADMIN Global Overview vs. ADMIN Project-Scoped Overview)
// =============================================================================
export const AdminOverviewScreen: React.FC<AdminViewProps> = ({
  data,
  activeProjectId,
  onSelectProjectContext,
  onNavigate,
}) => {
  const isSuperAdmin = data.currentUser.role === 'SUPER_ADMIN';

  const projectMap = useMemo(
    () => new Map(data.projects.map((p) => [p.projectId, p])),
    [data.projects]
  );
  const userMap = useMemo(
    () => new Map(data.users.map((u) => [u.userId, u])),
    [data.users]
  );
  const sprintMap = useMemo(
    () => new Map(data.sprints.map((s) => [s.sprintId, s.name])),
    [data.sprints]
  );

  const scopedProjects = useMemo(
    () =>
      activeProjectId
        ? data.projects.filter((p) => p.projectId === activeProjectId)
        : data.projects,
    [data.projects, activeProjectId]
  );

  const managedProjects = useMemo(
    () => data.projects.filter((p) => p.canManage),
    [data.projects]
  );

  const scopedEntries = useMemo(
    () =>
      activeProjectId
        ? data.workEntries.filter((w) => w.projectId === activeProjectId)
        : data.workEntries,
    [data.workEntries, activeProjectId]
  );

  const scopedSprints = useMemo(
    () =>
      activeProjectId
        ? data.sprints.filter((s) => s.projectId === activeProjectId)
        : data.sprints,
    [data.sprints, activeProjectId]
  );

  // Scoped metrics
  const activeAdminsCount = useMemo(
    () =>
      data.users.filter(
        (u) =>
          (u.role === 'ADMIN' || u.role === 'SUPER_ADMIN') &&
          u.status === 'Active'
      ).length,
    [data.users]
  );
  const activeMembersCount = useMemo(
    () =>
      data.users.filter((u) => u.role === 'MEMBER' && u.status === 'Active')
        .length,
    [data.users]
  );

  const projectScopedMemberCount = useMemo(() => {
    const ids = new Set<string>();
    const targetProjectIds = new Set(
      (activeProjectId ? scopedProjects : managedProjects).map(
        (p) => p.projectId
      )
    );
    for (const m of data.projectMemberships) {
      if (m.membershipStatus === 'Active' && targetProjectIds.has(m.projectId)) {
        ids.add(m.userId);
      }
    }
    return ids.size;
  }, [data.projectMemberships, activeProjectId, scopedProjects, managedProjects]);

  const submittedTodayCount = useMemo(
    () =>
      data.teamDailyOverview.filter(
        (m) => m.submissionStatusToday === 'Submitted'
      ).length,
    [data.teamDailyOverview]
  );

  const pendingTodayCount = useMemo(
    () =>
      data.teamDailyOverview.filter(
        (m) => m.submissionStatusToday !== 'Submitted'
      ).length,
    [data.teamDailyOverview]
  );

  const activeSprints = useMemo(
    () =>
      scopedSprints.filter(
        (s) => s.status === 'Active' || s.status === 'Planned'
      ),
    [scopedSprints]
  );

  const recentEntries = useMemo(
    () => scopedEntries.slice(0, 12),
    [scopedEntries]
  );

  const activeContextLabel = activeProjectId
    ? projectMap.get(activeProjectId)?.name || activeProjectId
    : isSuperAdmin
    ? 'All Workspace Projects'
    : 'All Administered Projects';

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4 border-b border-slate-200 pb-5">
        <div>
          <p className="text-xs text-slate-500">
            <span className="font-mono tabular-nums">{data.todayInTz}</span> ·{' '}
            {data.systemSettings.timezone} · {activeContextLabel}
          </p>
          <h1 className="mt-1 font-display text-2xl font-bold tracking-tight text-slate-900">
            {isSuperAdmin ? 'Executive Operations Overview' : 'Project Operations Overview'}
          </h1>
          <p className="mt-1 text-sm text-slate-600">
            {isSuperAdmin
              ? 'Organization-wide project visibility, user capacity, daily submission readiness, and weekly reporting.'
              : 'Project-scoped submission readiness, active sprints, team output, and weekly update generation for projects you administer.'}
          </p>
        </div>
      </div>

      {/* Role-Specific Metric Cards */}
      {isSuperAdmin ? (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-xs">
            <p className="text-xs font-medium text-slate-500">Total Projects</p>
            <p className="mt-2 font-mono text-2xl font-semibold text-slate-900 tabular-nums">
              {data.projects.length}
            </p>
            <p className="mt-1 text-xs text-slate-500">
              {data.projects.filter((p) => p.status === 'Active').length} Active ·{' '}
              {data.projects.filter((p) => p.status === 'Archived').length} Archived
            </p>
          </div>

          <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-xs">
            <p className="text-xs font-medium text-slate-500">Registered Users</p>
            <p className="mt-2 font-mono text-2xl font-semibold text-slate-900 tabular-nums">
              {data.users.length}
            </p>
            <p className="mt-1 text-xs text-slate-500">
              {activeAdminsCount} Active Admins · {activeMembersCount} Active Members
            </p>
          </div>

          <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-xs">
            <p className="text-xs font-medium text-slate-500">
              Daily Submissions ({data.todayInTz})
            </p>
            <p className="mt-2 font-mono text-2xl font-semibold text-emerald-700 tabular-nums">
              {submittedTodayCount}
              <span className="ml-2 text-sm font-normal text-amber-700">
                / {pendingTodayCount} pending
              </span>
            </p>
            <p className="mt-1 text-xs text-slate-500">
              Across active team accounts
            </p>
          </div>

          <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-xs">
            <p className="text-xs font-medium text-slate-500">
              Recorded Work Entries
            </p>
            <p className="mt-2 font-mono text-2xl font-semibold text-slate-900 tabular-nums">
              {scopedEntries.length}
            </p>
            <p className="mt-1 text-xs text-slate-500">
              Across {scopedSprints.length} sprints
            </p>
          </div>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-xs">
            <p className="text-xs font-medium text-slate-500">
              My Administered Projects
            </p>
            <p className="mt-2 font-mono text-2xl font-semibold text-slate-900 tabular-nums">
              {managedProjects.length}
            </p>
            <p className="mt-1 text-xs text-slate-500">
              {managedProjects.filter((p) => p.status === 'Active').length} Active
            </p>
          </div>

          <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-xs">
            <p className="text-xs font-medium text-slate-500">
              Active Members in Scope
            </p>
            <p className="mt-2 font-mono text-2xl font-semibold text-slate-900 tabular-nums">
              {projectScopedMemberCount}
            </p>
            <p className="mt-1 text-xs text-slate-500">
              Assigned to your projects
            </p>
          </div>

          <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-xs">
            <p className="text-xs font-medium text-slate-500">
              Submissions Today ({data.todayInTz})
            </p>
            <p className="mt-2 font-mono text-2xl font-semibold text-emerald-700 tabular-nums">
              {submittedTodayCount}
              <span className="ml-2 text-sm font-normal text-amber-700">
                / {pendingTodayCount} pending
              </span>
            </p>
            <p className="mt-1 text-xs text-slate-500">
              Team completion status
            </p>
          </div>

          <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-xs">
            <p className="text-xs font-medium text-slate-500">
              Active Sprints
            </p>
            <p className="mt-2 font-mono text-2xl font-semibold text-slate-900 tabular-nums">
              {activeSprints.length}
            </p>
            <p className="mt-1 text-xs text-slate-500">
              {scopedEntries.length} total entries logged
            </p>
          </div>
        </div>
      )}

      {/* Prominent One-Click Weekly Summary Generator */}
      <WeeklySummaryPanel
        todayInTz={data.todayInTz}
        projects={data.projects}
        selectedProjectId={activeProjectId}
      />

      {/* Project Summary Table (for Super Admin or Admin managing multiple projects) */}
      {scopedProjects.length > 0 && (
        <section className="rounded-xl border border-slate-200 bg-white shadow-xs">
          <div className="flex items-center justify-between border-b border-slate-200 px-5 py-3.5">
            <div className="flex items-center gap-2">
              <FolderKanban className="h-4 w-4 text-slate-500" />
              <h2 className="font-display text-sm font-semibold text-slate-900">
                Project Activity Summary ({scopedProjects.length})
              </h2>
            </div>
            {onNavigate && (
              <button
                type="button"
                onClick={() => onNavigate('projects')}
                className="text-xs font-medium text-blue-700 hover:underline"
              >
                Manage Projects
              </button>
            )}
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="border-b border-slate-200 bg-slate-50 text-xs text-slate-500">
                <tr>
                  <th className="px-4 py-2.5 font-medium">Project</th>
                  <th className="px-4 py-2.5 font-medium">Owner</th>
                  <th className="px-4 py-2.5 font-medium">Status</th>
                  <th className="px-4 py-2.5 font-medium">Members</th>
                  <th className="px-4 py-2.5 font-medium">Entries</th>
                  <th className="px-4 py-2.5 font-medium">Completed / Blocked</th>
                  <th className="px-4 py-2.5 font-medium">Scope</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {scopedProjects.map((p) => (
                  <tr key={p.projectId} className="hover:bg-slate-50">
                    <td className="px-4 py-3">
                      <div className="font-medium text-slate-900">{p.name}</div>
                      <div className="font-mono text-[11px] text-slate-400">
                        {p.projectId}
                      </div>
                    </td>
                    <td className="px-4 py-3 text-xs text-slate-700">
                      {p.ownerName}
                    </td>
                    <td className="px-4 py-3">
                      <StatusText status={p.status} />
                    </td>
                    <td className="px-4 py-3 font-mono text-xs text-slate-700 tabular-nums">
                      {p.adminCount + p.memberCount}
                    </td>
                    <td className="px-4 py-3 font-mono text-xs text-slate-900 tabular-nums">
                      {p.totalEntries}
                    </td>
                    <td className="px-4 py-3 font-mono text-xs tabular-nums">
                      <span className="text-emerald-700">
                        {p.completedEntries} done
                      </span>
                      <span className="mx-1.5 text-slate-300">/</span>
                      <span className="text-red-700">
                        {p.blockedEntries} blocked
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <button
                        type="button"
                        onClick={() =>
                          onSelectProjectContext(
                            activeProjectId === p.projectId ? '' : p.projectId
                          )
                        }
                        className="text-xs font-medium text-blue-700 hover:underline whitespace-nowrap"
                      >
                        {activeProjectId === p.projectId
                          ? 'Clear Focus'
                          : 'Focus Project'}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        {/* Today's Submission Status */}
        <section className="rounded-xl border border-slate-200 bg-white shadow-xs lg:col-span-2">
          <div className="flex items-center justify-between border-b border-slate-200 px-5 py-3.5">
            <h2 className="font-display text-sm font-semibold text-slate-900">
              Today&apos;s Submission Readiness ({data.todayInTz})
            </h2>
            {onNavigate && !isSuperAdmin && (
              <button
                type="button"
                onClick={() => onNavigate('team-work')}
                className="text-xs font-medium text-blue-700 hover:underline"
              >
                Inspect Team Work
              </button>
            )}
          </div>
          {data.teamDailyOverview.length === 0 ? (
            <div className="p-8 text-center text-sm text-slate-500">
              No active teammates found in current project scope.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead className="border-b border-slate-200 bg-slate-50 text-xs text-slate-500">
                  <tr>
                    <th className="px-4 py-2.5 font-medium">Member</th>
                    <th className="px-4 py-2.5 font-medium">Entries Today</th>
                    <th className="px-4 py-2.5 font-medium">Submission Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {data.teamDailyOverview.map((row) => (
                    <tr key={row.userId} className="hover:bg-slate-50">
                      <td className="px-4 py-3 font-medium text-slate-900">
                        {row.name}
                        <span className="ml-2 font-mono text-[11px] font-normal text-slate-400">
                          {row.role}
                        </span>
                      </td>
                      <td className="px-4 py-3 font-mono text-xs text-slate-700 tabular-nums">
                        {row.entriesTodayCount}
                      </td>
                      <td className="px-4 py-3">
                        <StatusText status={row.submissionStatusToday} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        {/* Active Sprint Snapshot */}
        <section className="rounded-xl border border-slate-200 bg-white shadow-xs">
          <div className="flex items-center justify-between border-b border-slate-200 px-5 py-3.5">
            <h2 className="font-display text-sm font-semibold text-slate-900">
              Sprint Visibility
            </h2>
            {onNavigate && !isSuperAdmin && (
              <button
                type="button"
                onClick={() => onNavigate('sprint-overview')}
                className="text-xs font-medium text-blue-700 hover:underline"
              >
                Manage Sprints
              </button>
            )}
          </div>
          {activeSprints.length === 0 ? (
            <div className="p-6 text-sm text-slate-500">
              No active or planned sprints in current project scope.
            </div>
          ) : (
            <div className="divide-y divide-slate-100">
              {activeSprints.map((sp) => (
                <div key={sp.sprintId} className="p-4 space-y-2">
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <p className="text-[11px] font-medium text-slate-400">
                        {projectMap.get(sp.projectId)?.name || sp.projectId}
                      </p>
                      <p className="text-sm font-semibold text-slate-900">
                        {sp.name}
                      </p>
                      <p className="font-mono text-xs text-slate-500 tabular-nums">
                        {sp.startDate} to {sp.endDate}
                      </p>
                    </div>
                    <StatusText status={sp.status} />
                  </div>
                  <p className="text-xs text-slate-600 line-clamp-2">
                    {sp.objective}
                  </p>
                  <div className="grid grid-cols-3 gap-2 border-t border-slate-100 pt-2 text-xs">
                    <div>
                      <span className="text-slate-400">Done: </span>
                      <span className="font-mono font-semibold text-emerald-700 tabular-nums">
                        {sp.completedCount}
                      </span>
                    </div>
                    <div>
                      <span className="text-slate-400">Active: </span>
                      <span className="font-mono font-semibold text-amber-700 tabular-nums">
                        {sp.inProgressCount}
                      </span>
                    </div>
                    <div>
                      <span className="text-slate-400">Blocked: </span>
                      <span className="font-mono font-semibold text-red-700 tabular-nums">
                        {sp.blockedCount}
                      </span>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>
      </div>

      {/* Recent Team Work Entries */}
      <section className="rounded-xl border border-slate-200 bg-white shadow-xs">
        <div className="flex items-center justify-between border-b border-slate-200 px-5 py-3.5">
          <h2 className="font-display text-sm font-semibold text-slate-900">
            Recent Project Work Activity
          </h2>
          {onNavigate && (
            <button
              type="button"
              onClick={() =>
                onNavigate(isSuperAdmin ? 'reports' : 'team-work')
              }
              className="text-xs font-medium text-blue-700 hover:underline"
            >
              {isSuperAdmin ? 'Open Full Reports' : 'View All Entries'}
            </button>
          )}
        </div>
        {recentEntries.length === 0 ? (
          <div className="p-8 text-center text-sm text-slate-500">
            No work entries logged in current project scope yet.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="border-b border-slate-200 bg-slate-50 text-xs text-slate-500">
                <tr>
                  <th className="px-4 py-2.5 font-medium">Date</th>
                  <th className="px-4 py-2.5 font-medium">Project</th>
                  <th className="px-4 py-2.5 font-medium">Member</th>
                  <th className="px-4 py-2.5 font-medium">Work Summary</th>
                  <th className="px-4 py-2.5 font-medium">Category</th>
                  <th className="px-4 py-2.5 font-medium">Sprint</th>
                  <th className="px-4 py-2.5 font-medium">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {recentEntries.map((entry) => (
                  <tr key={entry.workId} className="hover:bg-slate-50">
                    <td className="px-4 py-3 font-mono text-xs text-slate-600 tabular-nums whitespace-nowrap">
                      {entry.workDate}
                    </td>
                    <td className="px-4 py-3 text-xs font-medium text-slate-700 whitespace-nowrap">
                      {projectMap.get(entry.projectId)?.name || entry.projectId}
                    </td>
                    <td className="px-4 py-3 text-xs font-medium text-slate-900 whitespace-nowrap">
                      {userMap.get(entry.userId)?.name || entry.userId}
                    </td>
                    <td className="px-4 py-3 text-sm text-slate-900 max-w-md">
                      {entry.summary}
                    </td>
                    <td className="px-4 py-3 text-xs text-slate-600 whitespace-nowrap">
                      {entry.category}
                    </td>
                    <td className="px-4 py-3 text-xs text-slate-600 whitespace-nowrap">
                      {entry.sprintId
                        ? sprintMap.get(entry.sprintId) || entry.sprintId
                        : '—'}
                    </td>
                    <td className="px-4 py-3">
                      <StatusText status={entry.status} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
};

// =============================================================================
// 2. TEAM WORK (Project-Scoped Filterable Entries + Daily Submissions + Reopen)
// =============================================================================
export const AdminTeamWorkScreen: React.FC<AdminViewProps> = ({
  data,
  activeProjectId,
  onRefresh,
  onToast,
}) => {
  const [search, setSearch] = useState('');
  const [projectFilter, setProjectFilter] = useState(activeProjectId);
  const [memberFilter, setMemberFilter] = useState('');
  const [dateFilter, setDateFilter] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [sprintFilter, setSprintFilter] = useState('');

  useEffect(() => {
    setProjectFilter(activeProjectId);
  }, [activeProjectId]);

  const [reopenTarget, setReopenTarget] = useState<{
    userId: string;
    userName: string;
    workDate: string;
  } | null>(null);
  const [reopenReason, setReopenReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const projectMap = useMemo(
    () => new Map(data.projects.map((p) => [p.projectId, p])),
    [data.projects]
  );
  const userMap = useMemo(
    () => new Map(data.users.map((u) => [u.userId, u])),
    [data.users]
  );
  const sprintMap = useMemo(
    () => new Map(data.sprints.map((s) => [s.sprintId, s.name])),
    [data.sprints]
  );
  const submissionMap = useMemo(() => {
    const map = new Map<string, (typeof data.dailySubmissions)[number]>();
    for (const s of data.dailySubmissions) {
      map.set(`${s.userId}::${s.workDate}`, s);
    }
    return map;
  }, [data.dailySubmissions]);

  const distinctCategories = useMemo(
    () => Array.from(new Set(data.workEntries.map((w) => w.category))).sort(),
    [data.workEntries]
  );
  const distinctStatuses = useMemo(
    () => Array.from(new Set(data.workEntries.map((w) => w.status))).sort(),
    [data.workEntries]
  );

  const visibleSprints = useMemo(
    () =>
      projectFilter
        ? data.sprints.filter((s) => s.projectId === projectFilter)
        : data.sprints,
    [data.sprints, projectFilter]
  );

  const filteredEntries = useMemo(() => {
    return data.workEntries.filter((w) => {
      if (projectFilter && w.projectId !== projectFilter) return false;
      if (memberFilter && w.userId !== memberFilter) return false;
      if (dateFilter && w.workDate !== dateFilter) return false;
      if (categoryFilter && w.category !== categoryFilter) return false;
      if (statusFilter && w.status !== statusFilter) return false;
      if (sprintFilter && w.sprintId !== sprintFilter) return false;
      if (search) {
        const q = search.toLowerCase();
        const hit =
          w.summary.toLowerCase().includes(q) ||
          w.category.toLowerCase().includes(q) ||
          (w.adoReference || '').toLowerCase().includes(q) ||
          (projectMap.get(w.projectId)?.name || '').toLowerCase().includes(q) ||
          Object.values(w.fieldValues).some((v) =>
            String(v).toLowerCase().includes(q)
          );
        if (!hit) return false;
      }
      return true;
    });
  }, [
    data.workEntries,
    projectFilter,
    memberFilter,
    dateFilter,
    categoryFilter,
    statusFilter,
    sprintFilter,
    search,
    projectMap,
  ]);

  const filteredSubmissions = useMemo(() => {
    return data.dailySubmissions.filter((s) => {
      if (memberFilter && s.userId !== memberFilter) return false;
      if (dateFilter && s.workDate !== dateFilter) return false;
      if (projectFilter) {
        const hasProjectActivity =
          data.workEntries.some(
            (w) =>
              w.userId === s.userId &&
              w.workDate === s.workDate &&
              w.projectId === projectFilter
          ) ||
          data.projectMemberships.some(
            (m) =>
              m.userId === s.userId &&
              m.projectId === projectFilter &&
              m.membershipStatus === 'Active'
          );
        if (!hasProjectActivity) return false;
      }
      return true;
    });
  }, [
    data.dailySubmissions,
    data.workEntries,
    data.projectMemberships,
    memberFilter,
    dateFilter,
    projectFilter,
  ]);

  const handleReopenSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!reopenTarget) return;
    setBusy(true);
    setError(null);
    try {
      await apiRequest('/api/submissions/reopen', {
        method: 'POST',
        body: JSON.stringify({
          userId: reopenTarget.userId,
          workDate: reopenTarget.workDate,
          reason: reopenReason.trim(),
        }),
      });
      onToast(
        'success',
        `Reopened submission for ${reopenTarget.userName} on ${reopenTarget.workDate}.`
      );
      setReopenTarget(null);
      setReopenReason('');
      await onRefresh();
    } catch (err) {
      const msg =
        err instanceof Error ? err.message : 'Failed to reopen daily submission';
      setError(msg);
      onToast('error', msg);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="border-b border-slate-200 pb-5">
        <h1 className="font-display text-2xl font-bold tracking-tight text-slate-900">
          Team Work & Submissions
        </h1>
        <p className="mt-1 text-sm text-slate-600">
          Filter team work across your administered projects by member, date,
          sprint, category, status, or keyword, and reopen submitted days with an
          audited reason.
        </p>
      </div>

      {error && (
        <div
          role="alert"
          className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-xs text-red-800"
        >
          {error}
        </div>
      )}

      {/* Filter Bar */}
      <div className="grid grid-cols-1 gap-3 rounded-xl border border-slate-200 bg-white p-4 shadow-xs sm:grid-cols-2 lg:grid-cols-7">
        <div className="relative lg:col-span-2">
          <Search className="pointer-events-none absolute left-3 top-2.5 h-3.5 w-3.5 text-slate-400" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Keyword, project, summary, ADO ref..."
            className="w-full rounded-lg border border-slate-300 pl-8 pr-3 py-1.5 text-xs"
          />
        </div>

        <select
          aria-label="Filter by project"
          value={projectFilter}
          onChange={(e) => {
            setProjectFilter(e.target.value);
            setSprintFilter('');
          }}
          className="rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-xs"
        >
          <option value="">All Authorized Projects</option>
          {data.projects.map((p) => (
            <option key={p.projectId} value={p.projectId}>
              {p.name}
            </option>
          ))}
        </select>

        <select
          aria-label="Filter by team member"
          value={memberFilter}
          onChange={(e) => setMemberFilter(e.target.value)}
          className="rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-xs"
        >
          <option value="">All Members</option>
          {data.users.map((u) => (
            <option key={u.userId} value={u.userId}>
              {u.name}
            </option>
          ))}
        </select>

        <input
          type="date"
          aria-label="Filter by date"
          value={dateFilter}
          onChange={(e) => setDateFilter(e.target.value)}
          className="rounded-lg border border-slate-300 px-2.5 py-1.5 font-mono text-xs"
        />

        <select
          aria-label="Filter by sprint"
          value={sprintFilter}
          onChange={(e) => setSprintFilter(e.target.value)}
          className="rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-xs"
        >
          <option value="">All Sprints</option>
          {visibleSprints.map((s) => (
            <option key={s.sprintId} value={s.sprintId}>
              {s.name}
            </option>
          ))}
        </select>

        <div className="flex gap-2">
          <select
            aria-label="Filter by category"
            value={categoryFilter}
            onChange={(e) => setCategoryFilter(e.target.value)}
            className="w-full rounded-lg border border-slate-300 bg-white px-2 py-1.5 text-xs"
          >
            <option value="">Category</option>
            {distinctCategories.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>

          <select
            aria-label="Filter by status"
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="w-full rounded-lg border border-slate-300 bg-white px-2 py-1.5 text-xs"
          >
            <option value="">Status</option>
            {distinctStatuses.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* Work Entries Table */}
      <section className="rounded-xl border border-slate-200 bg-white shadow-xs">
        <div className="flex items-center justify-between border-b border-slate-200 px-5 py-3">
          <span className="font-display text-sm font-semibold text-slate-900">
            Work Entries ({filteredEntries.length})
          </span>
          {(search ||
            projectFilter ||
            memberFilter ||
            dateFilter ||
            categoryFilter ||
            statusFilter ||
            sprintFilter) && (
            <button
              type="button"
              onClick={() => {
                setSearch('');
                setProjectFilter('');
                setMemberFilter('');
                setDateFilter('');
                setCategoryFilter('');
                setStatusFilter('');
                setSprintFilter('');
              }}
              className="text-xs font-medium text-blue-700 hover:underline"
            >
              Clear Filters
            </button>
          )}
        </div>

        {filteredEntries.length === 0 ? (
          <div className="p-8 text-center text-sm text-slate-500">
            No work entries match the current filters.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="border-b border-slate-200 bg-slate-50 text-xs text-slate-500">
                <tr>
                  <th className="px-4 py-3 font-medium">Date</th>
                  <th className="px-4 py-3 font-medium">Project</th>
                  <th className="px-4 py-3 font-medium">Member</th>
                  <th className="px-4 py-3 font-medium">Work Details</th>
                  <th className="px-4 py-3 font-medium">Sprint & ADO</th>
                  <th className="px-4 py-3 font-medium">Work Status</th>
                  <th className="px-4 py-3 font-medium">Day Submission</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {filteredEntries.map((entry) => {
                  const member = userMap.get(entry.userId);
                  const sub = submissionMap.get(
                    `${entry.userId}::${entry.workDate}`
                  );
                  const fields = getFieldsForEntry(data, entry);
                  const proj = projectMap.get(entry.projectId);
                  return (
                    <tr key={entry.workId} className="hover:bg-slate-50 align-top">
                      <td className="px-4 py-3 font-mono text-xs text-slate-600 tabular-nums whitespace-nowrap">
                        <div>{entry.workDate}</div>
                        <div className="text-[11px] text-slate-400">
                          {entry.workId} · v{entry.configVersion}
                        </div>
                      </td>
                      <td className="px-4 py-3 text-xs font-medium text-slate-700 whitespace-nowrap">
                        {proj?.name || entry.projectId}
                      </td>
                      <td className="px-4 py-3 text-xs font-medium text-slate-900 whitespace-nowrap">
                        {member?.name || entry.userId}
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
                                f.systemRole !== 'sprint' &&
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
                                  {renderDynamicValue(
                                    entry.fieldValues[f.fieldId]
                                  )}
                                </span>
                              </div>
                            ))}
                        </div>
                      </td>
                      <td className="px-4 py-3 text-xs space-y-1 whitespace-nowrap">
                        <div className="text-slate-700">
                          {entry.sprintId
                            ? sprintMap.get(entry.sprintId) || entry.sprintId
                            : 'No Sprint'}
                        </div>
                        {entry.adoReference &&
                          (isHttpUrl(entry.adoReference) ? (
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
                            <div className="font-mono text-slate-600">
                              {entry.adoReference}
                            </div>
                          ))}
                      </td>
                      <td className="px-4 py-3">
                        <StatusText status={entry.status} />
                      </td>
                      <td className="px-4 py-3 space-y-1.5">
                        <StatusText status={sub?.status || 'Pending'} />
                        {sub?.status === 'Submitted' && proj?.canManage && (
                          <div>
                            <button
                              type="button"
                              onClick={() => {
                                setReopenTarget({
                                  userId: entry.userId,
                                  userName: member?.name || entry.userId,
                                  workDate: entry.workDate,
                                });
                                setReopenReason('');
                                setError(null);
                              }}
                              className="inline-flex items-center gap-1 text-xs font-medium text-blue-700 hover:underline whitespace-nowrap"
                            >
                              <RotateCcw className="h-3 w-3" />
                              <span>Reopen Day</span>
                            </button>
                          </div>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* Daily Submissions Records */}
      <section className="rounded-xl border border-slate-200 bg-white shadow-xs">
        <div className="border-b border-slate-200 px-5 py-3">
          <h2 className="font-display text-sm font-semibold text-slate-900">
            Daily Submission Records ({filteredSubmissions.length})
          </h2>
        </div>
        {filteredSubmissions.length === 0 ? (
          <div className="p-6 text-center text-sm text-slate-500">
            No daily submission records match the filter.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="border-b border-slate-200 bg-slate-50 text-xs text-slate-500">
                <tr>
                  <th className="px-4 py-2.5 font-medium">Work Date</th>
                  <th className="px-4 py-2.5 font-medium">Member</th>
                  <th className="px-4 py-2.5 font-medium">Entries</th>
                  <th className="px-4 py-2.5 font-medium">No-Work / Audit Note</th>
                  <th className="px-4 py-2.5 font-medium">Status</th>
                  <th className="px-4 py-2.5 font-medium">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {filteredSubmissions.map((sub) => {
                  const member = userMap.get(sub.userId);
                  return (
                    <tr key={sub.submissionId} className="hover:bg-slate-50">
                      <td className="px-4 py-3 font-mono text-xs text-slate-700 tabular-nums whitespace-nowrap">
                        {sub.workDate}
                      </td>
                      <td className="px-4 py-3 text-xs font-medium text-slate-900">
                        {member?.name || sub.userId}
                      </td>
                      <td className="px-4 py-3 font-mono text-xs text-slate-700 tabular-nums">
                        {sub.entryCount}
                      </td>
                      <td className="px-4 py-3 text-xs text-slate-600 max-w-md">
                        {sub.noWorkReason || sub.reopenReason || '—'}
                      </td>
                      <td className="px-4 py-3">
                        <StatusText status={sub.status} />
                      </td>
                      <td className="px-4 py-3">
                        {sub.status === 'Submitted' ? (
                          <button
                            type="button"
                            onClick={() => {
                              setReopenTarget({
                                userId: sub.userId,
                                userName: member?.name || sub.userId,
                                workDate: sub.workDate,
                              });
                              setReopenReason('');
                              setError(null);
                            }}
                            className="inline-flex items-center gap-1 text-xs font-medium text-blue-700 hover:underline whitespace-nowrap"
                          >
                            <RotateCcw className="h-3 w-3" />
                            <span>Reopen Day</span>
                          </button>
                        ) : (
                          <span className="text-xs text-slate-400">Unlocked</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* Reopen Submission Modal */}
      {reopenTarget && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/45 px-4"
          role="dialog"
          aria-modal="true"
        >
          <form
            onSubmit={handleReopenSubmit}
            className="w-full max-w-md rounded-xl border border-slate-200 bg-white p-6 shadow-xl space-y-4"
          >
            <div className="flex items-start justify-between">
              <div>
                <h3 className="font-display text-base font-semibold text-slate-900">
                  Reopen Daily Submission
                </h3>
                <p className="mt-1 text-xs text-slate-600">
                  Unlock {reopenTarget.workDate} for {reopenTarget.userName}. A
                  reason is mandatory and recorded in the audit log.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setReopenTarget(null)}
                className="rounded p-1 text-slate-400 hover:bg-slate-100"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-700">
                Audit Reason (minimum 5 characters)
              </label>
              <textarea
                required
                minLength={5}
                rows={3}
                value={reopenReason}
                onChange={(e) => setReopenReason(e.target.value)}
                placeholder="Reason for reopening submitted day..."
                className="mt-1.5 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
              />
            </div>

            <div className="flex justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setReopenTarget(null)}
                className="rounded-lg border border-slate-300 px-3.5 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={busy}
                className="rounded-lg bg-blue-700 px-4 py-2 text-xs font-semibold text-white hover:bg-blue-800 disabled:opacity-60"
              >
                {busy ? 'Reopening...' : 'Confirm Reopen'}
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
};

// =============================================================================
// 3. SPRINT OVERVIEW (Project-Scoped Sprint Management)
// =============================================================================
export const AdminSprintOverviewScreen: React.FC<AdminViewProps> = ({
  data,
  activeProjectId,
  onRefresh,
  onToast,
}) => {
  const manageableProjects = useMemo(
    () => data.projects.filter((p) => p.canManage && p.status !== 'Archived'),
    [data.projects]
  );

  const [projectFilter, setProjectFilter] = useState(activeProjectId);
  useEffect(() => {
    setProjectFilter(activeProjectId);
  }, [activeProjectId]);

  const visibleSprints = useMemo(
    () =>
      projectFilter
        ? data.sprints.filter((s) => s.projectId === projectFilter)
        : data.sprints,
    [data.sprints, projectFilter]
  );

  const [selectedSprintId, setSelectedSprintId] = useState<string>(
    visibleSprints[0]?.sprintId || ''
  );
  const [showSprintForm, setShowSprintForm] = useState(false);
  const [editingSprint, setEditingSprint] =
    useState<SprintOverviewSummary | null>(null);

  const [sprintProjectId, setSprintProjectId] = useState(
    activeProjectId || manageableProjects[0]?.projectId || ''
  );
  const [name, setName] = useState('');
  const [objective, setObjective] = useState('');
  const [startDate, setStartDate] = useState(data.todayInTz);
  const [endDate, setEndDate] = useState(data.todayInTz);
  const [status, setStatus] = useState<SprintStatus>('Planned');

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const selectedSprint =
    visibleSprints.find((s) => s.sprintId === selectedSprintId) ||
    visibleSprints[0];

  const projectMap = useMemo(
    () => new Map(data.projects.map((p) => [p.projectId, p])),
    [data.projects]
  );
  const userMap = useMemo(
    () => new Map(data.users.map((u) => [u.userId, u.name])),
    [data.users]
  );

  const sprintEntries = useMemo(() => {
    if (!selectedSprint) return [];
    return data.workEntries.filter(
      (w) => w.sprintId === selectedSprint.sprintId
    );
  }, [data.workEntries, selectedSprint]);

  const openCreateForm = () => {
    const defaultProj =
      (projectFilter &&
        manageableProjects.find((p) => p.projectId === projectFilter)
          ?.projectId) ||
      manageableProjects[0]?.projectId ||
      '';
    setEditingSprint(null);
    setSprintProjectId(defaultProj);
    setName('');
    setObjective('');
    setStartDate(data.todayInTz);
    setEndDate(data.todayInTz);
    setStatus('Planned');
    setShowSprintForm(true);
    setError(null);
  };

  const openEditForm = (s: SprintOverviewSummary) => {
    setEditingSprint(s);
    setSprintProjectId(s.projectId);
    setName(s.name);
    setObjective(s.objective);
    setStartDate(s.startDate);
    setEndDate(s.endDate);
    setStatus(s.status);
    setShowSprintForm(true);
    setError(null);
  };

  const handleSaveSprint = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      if (editingSprint) {
        await apiRequest(`/api/sprints/${editingSprint.sprintId}`, {
          method: 'PATCH',
          body: JSON.stringify({
            name,
            objective,
            startDate,
            endDate,
            status,
          }),
        });
        onToast('success', `Sprint "${name}" updated.`);
      } else {
        if (!sprintProjectId) {
          throw new Error('Select a project before creating a sprint.');
        }
        const created = await apiRequest<SprintOverviewSummary>('/api/sprints', {
          method: 'POST',
          body: JSON.stringify({
            projectId: sprintProjectId,
            name,
            objective,
            startDate,
            endDate,
            status,
          }),
        });
        setSelectedSprintId(created.sprintId);
        onToast('success', `Sprint "${name}" created.`);
      }
      setShowSprintForm(false);
      setEditingSprint(null);
      await onRefresh();
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to save sprint';
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
          <h1 className="font-display text-2xl font-bold tracking-tight text-slate-900">
            Sprint Overview
          </h1>
          <p className="mt-1 text-sm text-slate-600">
            Project-scoped sprint organization tracking objectives, associated
            work entries, completion counts, category breakdown, and ADO
            references.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <select
            aria-label="Filter sprints by project"
            value={projectFilter}
            onChange={(e) => setProjectFilter(e.target.value)}
            className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs"
          >
            <option value="">All Authorized Projects</option>
            {data.projects.map((p) => (
              <option key={p.projectId} value={p.projectId}>
                {p.name}
              </option>
            ))}
          </select>

          <button
            type="button"
            disabled={manageableProjects.length === 0}
            onClick={openCreateForm}
            className="inline-flex items-center gap-2 rounded-lg bg-blue-700 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-800 disabled:opacity-50 whitespace-nowrap shrink-0"
          >
            <Plus className="h-4 w-4" />
            <span>Create Sprint</span>
          </button>
        </div>
      </div>

      {manageableProjects.length === 0 && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-xs text-amber-900">
          You need Project Admin access to at least one active project to create
          or edit sprints.
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

      {showSprintForm && (
        <form
          onSubmit={handleSaveSprint}
          className="rounded-xl border border-slate-300 bg-white p-6 shadow-sm space-y-4"
        >
          <div className="flex items-center justify-between">
            <h2 className="font-display text-base font-semibold text-slate-900">
              {editingSprint
                ? `Edit Sprint (${editingSprint.sprintId})`
                : 'New Project Sprint'}
            </h2>
            <button
              type="button"
              onClick={() => setShowSprintForm(false)}
              className="rounded p-1 text-slate-400 hover:bg-slate-100"
            >
              <X className="h-4 w-4" />
            </button>
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <div>
              <label className="block text-xs font-medium text-slate-700">
                Project *
              </label>
              <select
                required
                disabled={!!editingSprint}
                value={sprintProjectId}
                onChange={(e) => setSprintProjectId(e.target.value)}
                className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm disabled:bg-slate-100"
              >
                <option value="">Select project...</option>
                {manageableProjects.map((p) => (
                  <option key={p.projectId} value={p.projectId}>
                    {p.name}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-700">
                Sprint Name *
              </label>
              <input
                type="text"
                required
                minLength={3}
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g., Sprint 24 — API Hardening"
                className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-700">
                Status *
              </label>
              <select
                value={status}
                onChange={(e) => setStatus(e.target.value as SprintStatus)}
                className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm"
              >
                {SPRINT_STATUSES.map((st) => (
                  <option key={st} value={st}>
                    {st}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-700">
                Start Date *
              </label>
              <input
                type="date"
                required
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
                className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 font-mono text-sm"
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-700">
                End Date *
              </label>
              <input
                type="date"
                required
                value={endDate}
                onChange={(e) => setEndDate(e.target.value)}
                className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 font-mono text-sm"
              />
            </div>

            <div className="sm:col-span-3">
              <label className="block text-xs font-medium text-slate-700">
                Sprint Objective *
              </label>
              <textarea
                rows={2}
                required
                minLength={3}
                value={objective}
                onChange={(e) => setObjective(e.target.value)}
                placeholder="Key delivery objective for this sprint..."
                className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
              />
            </div>
          </div>

          <div className="flex justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={() => setShowSprintForm(false)}
              className="rounded-lg border border-slate-300 px-4 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={busy}
              className="rounded-lg bg-blue-700 px-4 py-2 text-xs font-semibold text-white hover:bg-blue-800 disabled:opacity-60"
            >
              {busy ? 'Saving...' : editingSprint ? 'Update Sprint' : 'Save Sprint'}
            </button>
          </div>
        </form>
      )}

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        {/* Sprint List */}
        <div className="rounded-xl border border-slate-200 bg-white divide-y divide-slate-100 self-start shadow-xs overflow-hidden">
          <div className="px-4 py-3 border-b border-slate-200 bg-slate-50/60 font-display text-xs font-semibold text-slate-700">
            Project Sprints ({visibleSprints.length})
          </div>
          {visibleSprints.length === 0 ? (
            <div className="p-6 text-sm text-slate-500">
              No sprints created for this filter yet.
            </div>
          ) : (
            visibleSprints.map((sp) => {
              const isSelected = selectedSprint?.sprintId === sp.sprintId;
              return (
                <div
                  key={sp.sprintId}
                  onClick={() => setSelectedSprintId(sp.sprintId)}
                  className={`cursor-pointer p-4 space-y-1.5 transition-colors ${
                    isSelected ? 'bg-blue-50/60' : 'hover:bg-slate-50'
                  }`}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <p className="text-[11px] text-slate-400">
                        {projectMap.get(sp.projectId)?.name || sp.projectId}
                      </p>
                      <span className="text-sm font-semibold text-slate-900">
                        {sp.name}
                      </span>
                    </div>
                    <StatusText status={sp.status} />
                  </div>
                  <div className="flex items-center justify-between text-xs text-slate-500">
                    <span className="font-mono tabular-nums">
                      {sp.startDate} to {sp.endDate}
                    </span>
                    <span className="font-mono tabular-nums">
                      {sp.totalEntries} entries
                    </span>
                  </div>
                </div>
              );
            })
          )}
        </div>

        {/* Selected Sprint Overview */}
        <div className="lg:col-span-2 space-y-6">
          {!selectedSprint ? (
            <div className="rounded-xl border border-slate-200 bg-white p-8 text-center text-sm text-slate-500 shadow-xs">
              Select or create a sprint to view its work entries and breakdown.
            </div>
          ) : (
            <>
              <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-xs space-y-5">
                <div className="flex flex-wrap items-start justify-between gap-4">
                  <div>
                    <div className="flex flex-wrap items-center gap-2.5">
                      <span className="font-mono text-xs text-slate-500">
                        {selectedSprint.sprintId}
                      </span>
                      <span className="text-slate-300">·</span>
                      <span className="text-xs font-medium text-slate-700">
                        {projectMap.get(selectedSprint.projectId)?.name ||
                          selectedSprint.projectId}
                      </span>
                      <span className="text-slate-300">·</span>
                      <StatusText status={selectedSprint.status} />
                    </div>
                    <h2 className="mt-1 font-display text-xl font-bold text-slate-900">
                      {selectedSprint.name}
                    </h2>
                    <p className="mt-1 text-sm text-slate-600">
                      {selectedSprint.objective}
                    </p>
                    <p className="mt-2 font-mono text-xs text-slate-500 tabular-nums">
                      Period: {selectedSprint.startDate} to{' '}
                      {selectedSprint.endDate}
                    </p>
                  </div>

                  {projectMap.get(selectedSprint.projectId)?.canManage && (
                    <button
                      type="button"
                      onClick={() => openEditForm(selectedSprint)}
                      className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50"
                    >
                      <Edit3 className="h-3.5 w-3.5" />
                      <span>Edit Sprint</span>
                    </button>
                  )}
                </div>

                {/* Status Counts */}
                <div className="grid grid-cols-2 gap-4 border-t border-slate-100 pt-4 sm:grid-cols-4">
                  <div>
                    <p className="text-xs text-slate-500">Total Entries</p>
                    <p className="mt-1 font-mono text-xl font-semibold text-slate-900 tabular-nums">
                      {selectedSprint.totalEntries}
                    </p>
                  </div>
                  <div>
                    <p className="text-xs text-slate-500">Completed</p>
                    <p className="mt-1 font-mono text-xl font-semibold text-emerald-700 tabular-nums">
                      {selectedSprint.completedCount}
                    </p>
                  </div>
                  <div>
                    <p className="text-xs text-slate-500">In Progress</p>
                    <p className="mt-1 font-mono text-xl font-semibold text-amber-700 tabular-nums">
                      {selectedSprint.inProgressCount}
                    </p>
                  </div>
                  <div>
                    <p className="text-xs text-slate-500">Blocked</p>
                    <p className="mt-1 font-mono text-xl font-semibold text-red-700 tabular-nums">
                      {selectedSprint.blockedCount}
                    </p>
                  </div>
                </div>

                {/* Breakdown Grids */}
                <div className="grid grid-cols-1 gap-6 border-t border-slate-100 pt-4 sm:grid-cols-3">
                  <div>
                    <h3 className="text-xs font-semibold text-slate-700">
                      Category Breakdown
                    </h3>
                    {selectedSprint.categoryBreakdown.length === 0 ? (
                      <p className="mt-2 text-xs text-slate-400">
                        No entries yet.
                      </p>
                    ) : (
                      <ul className="mt-2 space-y-1 text-xs">
                        {selectedSprint.categoryBreakdown.map((c) => (
                          <li
                            key={c.category}
                            className="flex items-center justify-between text-slate-700"
                          >
                            <span>{c.category}</span>
                            <span className="font-mono tabular-nums text-slate-500">
                              {c.count}
                            </span>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>

                  <div>
                    <h3 className="text-xs font-semibold text-slate-700">
                      Team Contributions
                    </h3>
                    {selectedSprint.memberContributions.length === 0 ? (
                      <p className="mt-2 text-xs text-slate-400">
                        No contributors yet.
                      </p>
                    ) : (
                      <ul className="mt-2 space-y-1 text-xs">
                        {selectedSprint.memberContributions.map((m) => (
                          <li
                            key={m.userId}
                            className="flex items-center justify-between text-slate-700"
                          >
                            <span>{m.name}</span>
                            <span className="font-mono tabular-nums text-slate-500">
                              {m.count}
                            </span>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>

                  <div>
                    <h3 className="text-xs font-semibold text-slate-700">
                      ADO References
                    </h3>
                    {selectedSprint.adoReferences.length === 0 ? (
                      <p className="mt-2 text-xs text-slate-400">
                        None linked.
                      </p>
                    ) : (
                      <ul className="mt-2 space-y-1 text-xs">
                        {selectedSprint.adoReferences.map((ref) => (
                          <li key={ref}>
                            {isHttpUrl(ref) ? (
                              <a
                                href={ref}
                                target="_blank"
                                rel="noreferrer"
                                className="inline-flex items-center gap-1 font-mono text-blue-700 hover:underline break-all"
                              >
                                <span>ADO Ticket</span>
                                <ExternalLink className="h-3 w-3 shrink-0" />
                              </a>
                            ) : (
                              <span className="font-mono text-slate-700">
                                {ref}
                              </span>
                            )}
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                </div>
              </div>

              {/* Associated Work Entries */}
              <div className="rounded-xl border border-slate-200 bg-white shadow-xs">
                <div className="border-b border-slate-200 px-5 py-3">
                  <h3 className="font-display text-sm font-semibold text-slate-900">
                    Associated Work Entries ({sprintEntries.length})
                  </h3>
                </div>
                {sprintEntries.length === 0 ? (
                  <div className="p-6 text-center text-sm text-slate-500">
                    No work entries have been associated with this sprint yet.
                  </div>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-left text-sm">
                      <thead className="border-b border-slate-200 bg-slate-50 text-xs text-slate-500">
                        <tr>
                          <th className="px-4 py-2.5 font-medium">Date</th>
                          <th className="px-4 py-2.5 font-medium">Member</th>
                          <th className="px-4 py-2.5 font-medium">Summary</th>
                          <th className="px-4 py-2.5 font-medium">Category</th>
                          <th className="px-4 py-2.5 font-medium">Status</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        {sprintEntries.map((w) => (
                          <tr key={w.workId} className="hover:bg-slate-50">
                            <td className="px-4 py-3 font-mono text-xs text-slate-600 tabular-nums whitespace-nowrap">
                              {w.workDate}
                            </td>
                            <td className="px-4 py-3 text-xs font-medium text-slate-900 whitespace-nowrap">
                              {userMap.get(w.userId) || w.userId}
                            </td>
                            <td className="px-4 py-3 text-sm text-slate-900">
                              {w.summary}
                            </td>
                            <td className="px-4 py-3 text-xs text-slate-600 whitespace-nowrap">
                              {w.category}
                            </td>
                            <td className="px-4 py-3">
                              <StatusText status={w.status} />
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
};

// =============================================================================
// 4. USERS / TEAM MEMBERS (Strict 3-Level Role Hierarchy)
// =============================================================================
export const AdminUsersScreen: React.FC<AdminViewProps> = ({
  data,
  activeProjectId,
  onRefresh,
  onToast,
}) => {
  const isSuperAdmin = data.currentUser.role === 'SUPER_ADMIN';
  const manageableProjects = useMemo(
    () => data.projects.filter((p) => p.canManage && p.status !== 'Archived'),
    [data.projects]
  );

  const [search, setSearch] = useState('');
  const [roleFilter, setRoleFilter] = useState('');
  const [showAddForm, setShowAddForm] = useState(false);
  const [email, setEmail] = useState('');
  const [name, setName] = useState('');
  const [role, setRole] = useState<UserRole>('MEMBER');
  const [initialProjectId, setInitialProjectId] = useState(
    activeProjectId || ''
  );
  const [initialProjectRole, setInitialProjectRole] =
    useState<ProjectRole>('PROJECT_MEMBER');

  const [historyUser, setHistoryUser] = useState<UserRecord | null>(null);
  const [deactivateTarget, setDeactivateTarget] = useState<UserRecord | null>(
    null
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const projectMap = useMemo(
    () => new Map(data.projects.map((p) => [p.projectId, p])),
    [data.projects]
  );

  const membershipsByUser = useMemo(() => {
    const map = new Map<string, typeof data.projectMemberships>();
    for (const m of data.projectMemberships) {
      const list = map.get(m.userId) || [];
      list.push(m);
      map.set(m.userId, list);
    }
    return map;
  }, [data.projectMemberships]);

  const filteredUsers = useMemo(() => {
    return data.users.filter((u) => {
      if (!isSuperAdmin && u.role === 'SUPER_ADMIN') return false;
      if (roleFilter && u.role !== roleFilter) return false;
      if (search.trim()) {
        const q = search.toLowerCase();
        if (
          !u.name.toLowerCase().includes(q) &&
          !u.email.toLowerCase().includes(q)
        ) {
          return false;
        }
      }
      return true;
    });
  }, [data.users, isSuperAdmin, roleFilter, search]);

  const handleAddUser = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const chosenGlobalRole: UserRole = isSuperAdmin ? role : 'MEMBER';
      await apiRequest('/api/team', {
        method: 'POST',
        body: JSON.stringify({
          email: email.trim().toLowerCase(),
          name: name.trim(),
          role: chosenGlobalRole,
          status: 'Active',
          projectId: initialProjectId || undefined,
          projectRole:
            initialProjectId && chosenGlobalRole !== 'MEMBER'
              ? initialProjectRole
              : initialProjectId
              ? 'PROJECT_MEMBER'
              : undefined,
        }),
      });
      onToast(
        'success',
        `Added ${email.trim()} (${chosenGlobalRole})${
          initialProjectId ? ' with project access.' : '.'
        }`
      );
      setEmail('');
      setName('');
      setRole('MEMBER');
      setShowAddForm(false);
      await onRefresh();
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to add user';
      setError(msg);
      onToast('error', msg);
    } finally {
      setBusy(false);
    }
  };

  const handleUpdateUser = async (
    user: UserRecord,
    patch: Partial<{ role: UserRole; status: 'Active' | 'Inactive' }>
  ) => {
    setBusy(true);
    setError(null);
    try {
      await apiRequest(`/api/team/${user.userId}`, {
        method: 'PATCH',
        body: JSON.stringify(patch),
      });
      onToast('success', `Updated account settings for ${user.name}.`);
      setDeactivateTarget(null);
      await onRefresh();
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to update user';
      setError(msg);
      onToast('error', msg);
      setDeactivateTarget(null);
    } finally {
      setBusy(false);
    }
  };

  const memberHistoryEntries = useMemo(() => {
    if (!historyUser) return [];
    return data.workEntries.filter((w) => w.userId === historyUser.userId);
  }, [data.workEntries, historyUser]);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4 border-b border-slate-200 pb-5">
        <div>
          <h1 className="font-display text-2xl font-bold tracking-tight text-slate-900">
            {isSuperAdmin ? 'User & Role Governance' : 'Team Members'}
          </h1>
          <p className="mt-1 text-sm text-slate-600">
            {isSuperAdmin
              ? 'Create or invite Super Admins, Admins, and Members, manage global roles and activation states, and inspect project assignments & work history.'
              : 'Add and manage Member accounts across your administered projects. Admins cannot promote global Admins or manage Super Admins.'}
          </p>
        </div>

        <button
          type="button"
          onClick={() => {
            setShowAddForm(!showAddForm);
            setError(null);
          }}
          className="inline-flex items-center gap-2 rounded-lg bg-blue-700 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-800 whitespace-nowrap shrink-0"
        >
          <UserPlus className="h-4 w-4" />
          <span>{isSuperAdmin ? 'Create / Invite User' : 'Add Member'}</span>
        </button>
      </div>

      {!isSuperAdmin && (
        <div className="flex items-center gap-2.5 rounded-lg border border-slate-200 bg-white px-4 py-3 text-xs text-slate-600">
          <ShieldAlert className="h-4 w-4 shrink-0 text-slate-500" />
          <span>
            Role Hierarchy Policy: As an Admin, you can invite and manage{' '}
            <strong>MEMBER</strong> accounts and assign project memberships
            within projects you administer. Only a Super Admin can create or
            modify Admin roles.
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

      {showAddForm && (
        <form
          onSubmit={handleAddUser}
          className="rounded-xl border border-slate-300 bg-white p-6 shadow-sm space-y-4"
        >
          <div className="flex items-center justify-between">
            <h2 className="font-display text-base font-semibold text-slate-900">
              {isSuperAdmin
                ? 'Pre-Authorize Workspace Account'
                : 'Add Team Member Account'}
            </h2>
            <button
              type="button"
              onClick={() => setShowAddForm(false)}
              className="rounded p-1 text-slate-400 hover:bg-slate-100"
            >
              <X className="h-4 w-4" />
            </button>
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <div>
              <label className="block text-xs font-medium text-slate-700">
                Full Name *
              </label>
              <input
                type="text"
                required
                minLength={2}
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Jane Doe"
                className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-700">
                Work Email *
              </label>
              <input
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="jane@company.com"
                className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-700">
                Global Role *
              </label>
              {isSuperAdmin ? (
                <select
                  value={role}
                  onChange={(e) => {
                    const next = e.target.value as UserRole;
                    setRole(next);
                    if (next === 'MEMBER') setInitialProjectRole('PROJECT_MEMBER');
                  }}
                  className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm"
                >
                  <option value="MEMBER">MEMBER</option>
                  <option value="ADMIN">ADMIN</option>
                  <option value="SUPER_ADMIN">SUPER_ADMIN</option>
                </select>
              ) : (
                <input
                  type="text"
                  readOnly
                  value="MEMBER"
                  className="mt-1 w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 font-mono text-sm text-slate-600"
                />
              )}
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-700">
                Assign to Project (optional)
              </label>
              <select
                value={initialProjectId}
                onChange={(e) => setInitialProjectId(e.target.value)}
                className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm"
              >
                <option value="">No immediate project assignment</option>
                {manageableProjects.map((p) => (
                  <option key={p.projectId} value={p.projectId}>
                    {p.name}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {initialProjectId && isSuperAdmin && role !== 'MEMBER' && (
            <div className="max-w-xs">
              <label className="block text-xs font-medium text-slate-700">
                Initial Project Role
              </label>
              <select
                value={initialProjectRole}
                onChange={(e) =>
                  setInitialProjectRole(e.target.value as ProjectRole)
                }
                className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs"
              >
                <option value="PROJECT_MEMBER">PROJECT_MEMBER</option>
                <option value="PROJECT_ADMIN">PROJECT_ADMIN</option>
              </select>
            </div>
          )}

          <div className="flex justify-end gap-2 border-t border-slate-100 pt-3">
            <button
              type="button"
              onClick={() => setShowAddForm(false)}
              className="rounded-lg border border-slate-300 px-4 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={busy}
              className="rounded-lg bg-blue-700 px-4 py-2 text-xs font-semibold text-white hover:bg-blue-800 disabled:opacity-60"
            >
              {busy ? 'Saving...' : 'Save Account'}
            </button>
          </div>
        </form>
      )}

      {/* Search & Filter Row */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative flex-1 min-w-[220px] max-w-sm">
          <Search className="pointer-events-none absolute left-3 top-2.5 h-3.5 w-3.5 text-slate-400" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by name or email..."
            className="w-full rounded-lg border border-slate-300 bg-white pl-8 pr-3 py-2 text-xs"
          />
        </div>
        <select
          aria-label="Filter users by role"
          value={roleFilter}
          onChange={(e) => setRoleFilter(e.target.value)}
          className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs"
        >
          <option value="">All Roles</option>
          {isSuperAdmin && <option value="SUPER_ADMIN">SUPER_ADMIN</option>}
          <option value="ADMIN">ADMIN</option>
          <option value="MEMBER">MEMBER</option>
        </select>
      </div>

      {/* Users Table */}
      <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-xs">
        <table className="w-full text-left text-sm">
          <thead className="border-b border-slate-200 bg-slate-50 text-xs text-slate-500">
            <tr>
              <th className="px-4 py-3 font-medium">Name</th>
              <th className="px-4 py-3 font-medium">Email</th>
              <th className="px-4 py-3 font-medium">Global Role</th>
              <th className="px-4 py-3 font-medium">Projects</th>
              <th className="px-4 py-3 font-medium">Status</th>
              <th className="px-4 py-3 font-medium">Entries</th>
              <th className="px-4 py-3 font-medium">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {filteredUsers.map((u) => {
              const entryCount = data.workEntries.filter(
                (w) => w.userId === u.userId
              ).length;
              const userMemberships = (membershipsByUser.get(u.userId) || []).filter(
                (m) => m.membershipStatus === 'Active'
              );
              const canEditAccount =
                isSuperAdmin ||
                (u.role === 'MEMBER' && u.userId !== data.currentUser.userId);

              return (
                <tr key={u.userId} className="hover:bg-slate-50">
                  <td className="px-4 py-3 font-medium text-slate-900">
                    {u.name}
                    {u.userId === data.currentUser.userId && (
                      <span className="ml-2 text-xs text-slate-400">(You)</span>
                    )}
                  </td>
                  <td className="px-4 py-3 font-mono text-xs text-slate-600">
                    {u.email}
                  </td>
                  <td className="px-4 py-3">
                    {isSuperAdmin ? (
                      <select
                        aria-label={`Role for ${u.name}`}
                        disabled={busy}
                        value={u.role}
                        onChange={(e) =>
                          handleUpdateUser(u, {
                            role: e.target.value as UserRole,
                          })
                        }
                        className="rounded-md border border-slate-300 bg-white px-2 py-1 font-mono text-xs font-medium text-slate-800"
                      >
                        <option value="MEMBER">MEMBER</option>
                        <option value="ADMIN">ADMIN</option>
                        <option value="SUPER_ADMIN">SUPER_ADMIN</option>
                      </select>
                    ) : (
                      <span className="font-mono text-xs font-medium text-slate-700">
                        {u.role}
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-3 font-mono text-xs text-slate-600 tabular-nums">
                    {userMemberships.length}
                  </td>
                  <td className="px-4 py-3">
                    <StatusText status={u.status} />
                  </td>
                  <td className="px-4 py-3 font-mono text-xs text-slate-700 tabular-nums">
                    {entryCount}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-3 text-xs">
                      <button
                        type="button"
                        onClick={() => setHistoryUser(u)}
                        className="inline-flex items-center gap-1 font-medium text-blue-700 hover:underline whitespace-nowrap"
                      >
                        <History className="h-3.5 w-3.5" />
                        <span>Inspect</span>
                      </button>
                      {canEditAccount && (
                        <button
                          type="button"
                          disabled={busy}
                          onClick={() => {
                            if (u.status === 'Active') {
                              setDeactivateTarget(u);
                            } else {
                              void handleUpdateUser(u, { status: 'Active' });
                            }
                          }}
                          className="font-medium text-slate-600 hover:text-slate-900 hover:underline whitespace-nowrap"
                        >
                          {u.status === 'Active' ? 'Deactivate' : 'Activate'}
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Individual User Project Memberships & Work History Inspector */}
      {historyUser && (
        <section className="rounded-xl border border-slate-300 bg-white shadow-sm">
          <div className="flex items-center justify-between border-b border-slate-200 px-5 py-3.5">
            <div>
              <h2 className="font-display text-sm font-semibold text-slate-900">
                {historyUser.name} ({historyUser.email}) · {historyUser.role}
              </h2>
              <p className="text-xs text-slate-500">
                {memberHistoryEntries.length} recorded work entries · Updated{' '}
                {formatUtcInTimezone(
                  historyUser.updatedAt,
                  data.systemSettings.timezone
                )}
              </p>
            </div>
            <button
              type="button"
              onClick={() => setHistoryUser(null)}
              className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
            >
              <X className="h-4 w-4" />
            </button>
          </div>

          <div className="border-b border-slate-100 bg-slate-50/50 px-5 py-3">
            <p className="text-xs font-semibold text-slate-700">
              Project Memberships
            </p>
            {(membershipsByUser.get(historyUser.userId) || []).length === 0 ? (
              <p className="mt-1 text-xs text-slate-500">
                No explicit project memberships in visible scope.
              </p>
            ) : (
              <div className="mt-2 flex flex-wrap gap-3 text-xs">
                {(membershipsByUser.get(historyUser.userId) || []).map((m) => (
                  <div
                    key={m.membershipId}
                    className="flex items-center gap-2 rounded-md border border-slate-200 bg-white px-3 py-1.5"
                  >
                    <span className="font-medium text-slate-900">
                      {projectMap.get(m.projectId)?.name || m.projectId}
                    </span>
                    <span className="font-mono text-[11px] text-slate-500">
                      {m.projectRole}
                    </span>
                    <StatusText status={m.membershipStatus} />
                  </div>
                ))}
              </div>
            )}
          </div>

          {memberHistoryEntries.length === 0 ? (
            <div className="p-6 text-center text-sm text-slate-500">
              This user has no recorded work entries in visible scope.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead className="border-b border-slate-200 bg-slate-50 text-xs text-slate-500">
                  <tr>
                    <th className="px-4 py-2.5 font-medium">Date</th>
                    <th className="px-4 py-2.5 font-medium">Project</th>
                    <th className="px-4 py-2.5 font-medium">Summary</th>
                    <th className="px-4 py-2.5 font-medium">Category</th>
                    <th className="px-4 py-2.5 font-medium">Status</th>
                    <th className="px-4 py-2.5 font-medium">ADO Reference</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {memberHistoryEntries.map((w) => (
                    <tr key={w.workId} className="hover:bg-slate-50">
                      <td className="px-4 py-2.5 font-mono text-xs text-slate-600 tabular-nums whitespace-nowrap">
                        {w.workDate}
                      </td>
                      <td className="px-4 py-2.5 text-xs font-medium text-slate-700 whitespace-nowrap">
                        {projectMap.get(w.projectId)?.name || w.projectId}
                      </td>
                      <td className="px-4 py-2.5 text-sm text-slate-900">
                        {w.summary}
                      </td>
                      <td className="px-4 py-2.5 text-xs text-slate-600 whitespace-nowrap">
                        {w.category}
                      </td>
                      <td className="px-4 py-2.5">
                        <StatusText status={w.status} />
                      </td>
                      <td className="px-4 py-2.5 font-mono text-xs text-slate-600">
                        {w.adoReference || '—'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      )}

      <ConfirmDialog
        open={!!deactivateTarget}
        title="Deactivate User Account"
        description={`Deactivate ${deactivateTarget?.name} (${deactivateTarget?.email})? They will be unable to sign in or log new work, while historical work records remain intact.`}
        confirmLabel="Deactivate"
        tone="danger"
        busy={busy}
        onConfirm={() => {
          if (deactivateTarget) {
            void handleUpdateUser(deactivateTarget, { status: 'Inactive' });
          }
        }}
        onCancel={() => setDeactivateTarget(null)}
      />
    </div>
  );
};
