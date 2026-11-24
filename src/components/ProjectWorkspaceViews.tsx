import React, { useMemo, useState } from 'react';
import {
  CheckCircle2,
  FolderPlus,
  KeyRound,
  MailPlus,
  Search,
  Settings2,
  Shield,
  Sliders,
  Trash2,
  UserCheck,
  Users,
  X,
} from 'lucide-react';
import type {
  ProjectMembership,
  ProjectRole,
  ProjectStatus,
  ProjectSummary,
} from '../types';
import {
  apiRequest,
  formatUtcInTimezone,
  type BootstrapPayload,
} from '../lib/api';
import { ConfirmDialog } from './ConfirmDialog';
import { StatusText } from './StatusText';

interface ProjectsScreenProps {
  data: BootstrapPayload;
  activeProjectId: string;
  onSelectProjectContext: (projectId: string) => void;
  onOpenProjectConfig?: (projectId: string) => void;
  onRefresh: () => Promise<void>;
  onToast: (tone: 'success' | 'error' | 'info', message: string) => void;
  isPreviewMode?: boolean;
}

export const ProjectsScreen: React.FC<ProjectsScreenProps> = ({
  data,
  activeProjectId,
  onSelectProjectContext,
  onOpenProjectConfig,
  onRefresh,
  onToast,
  isPreviewMode = false,
}) => {
  const isSuperAdmin =
    !isPreviewMode && data.currentUser.role === 'SUPER_ADMIN';
  const canCreate =
    !isPreviewMode &&
    (data.currentUser.role === 'SUPER_ADMIN' ||
      data.currentUser.role === 'ADMIN');

  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('');
  const [selectedProjectId, setSelectedProjectId] = useState<string>(
    activeProjectId || data.projects[0]?.projectId || ''
  );

  // Create Project Modal/Drawer
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [newName, setNewName] = useState('');
  const [newDesc, setNewDesc] = useState('');
  const [newStatus, setNewStatus] = useState<ProjectStatus>('Active');
  const [newUseOverride, setNewUseOverride] = useState(false);

  // Edit Project State
  const [editingProject, setEditingProject] = useState<ProjectSummary | null>(
    null
  );
  const [editName, setEditName] = useState('');
  const [editDesc, setEditDesc] = useState('');
  const [editStatus, setEditStatus] = useState<ProjectStatus>('Active');

  // Manage Access Drawer Tab & Forms
  const [detailTab, setDetailTab] = useState<'overview' | 'access'>('overview');
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteRole, setInviteRole] = useState<ProjectRole>('PROJECT_MEMBER');
  const [inviteDays, setInviteDays] = useState('7');
  const [memberSearch, setMemberSearch] = useState('');

  // Ownership Transfer (Super Admin)
  const [transferOwnerId, setTransferOwnerId] = useState('');

  // Confirmation dialogs
  const [removeTarget, setRemoveTarget] = useState<{
    projectId: string;
    membership: ProjectMembership;
    userName: string;
  } | null>(null);
  const [revokeInviteId, setRevokeInviteId] = useState<string | null>(null);

  const [busy, setBusy] = useState(false);

  const userMap = useMemo(
    () => new Map(data.users.map((u) => [u.userId, u])),
    [data.users]
  );

  // Pending invitations addressed to the signed-in user
  const myPendingInvitations = useMemo(
    () =>
      data.projectInvitations.filter(
        (inv) =>
          inv.inviteeEmail.toLowerCase() ===
            data.currentUser.email.toLowerCase() &&
          inv.invitationStatus === 'Pending'
      ),
    [data.projectInvitations, data.currentUser.email]
  );

  const filteredProjects = useMemo(() => {
    return data.projects.filter((p) => {
      if (statusFilter && p.status !== statusFilter) return false;
      if (search.trim()) {
        const q = search.toLowerCase();
        if (
          !p.name.toLowerCase().includes(q) &&
          !p.description.toLowerCase().includes(q) &&
          !p.projectId.toLowerCase().includes(q)
        ) {
          return false;
        }
      }
      return true;
    });
  }, [data.projects, search, statusFilter]);

  const focusedProject =
    data.projects.find((p) => p.projectId === selectedProjectId) ||
    filteredProjects[0] ||
    null;

  const focusedMemberships = useMemo(() => {
    if (!focusedProject) return [];
    return data.projectMemberships.filter(
      (m) => m.projectId === focusedProject.projectId
    );
  }, [data.projectMemberships, focusedProject]);

  const focusedInvitations = useMemo(() => {
    if (!focusedProject) return [];
    return data.projectInvitations.filter(
      (inv) => inv.projectId === focusedProject.projectId
    );
  }, [data.projectInvitations, focusedProject]);

  const handleCreateProject = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      const created = await apiRequest<ProjectSummary>('/api/projects', {
        method: 'POST',
        body: JSON.stringify({
          name: newName.trim(),
          description: newDesc.trim(),
          status: newStatus,
          useProjectConfig: newUseOverride,
        }),
      });
      setShowCreateForm(false);
      setNewName('');
      setNewDesc('');
      setSelectedProjectId(created.projectId);
      onSelectProjectContext(created.projectId);
      onToast(
        'success',
        `Project "${created.name}" created with Project Admin access assigned.`
      );
      await onRefresh();
    } catch (err) {
      onToast(
        'error',
        err instanceof Error ? err.message : 'Failed to create project'
      );
    } finally {
      setBusy(false);
    }
  };

  const handleSaveProjectEdit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingProject) return;
    setBusy(true);
    try {
      await apiRequest(`/api/projects/${editingProject.projectId}`, {
        method: 'PATCH',
        body: JSON.stringify({
          name: editName.trim(),
          description: editDesc.trim(),
          status: editStatus,
        }),
      });
      setEditingProject(null);
      onToast('success', 'Project details updated.');
      await onRefresh();
    } catch (err) {
      onToast(
        'error',
        err instanceof Error ? err.message : 'Failed to update project'
      );
    } finally {
      setBusy(false);
    }
  };

  const handleSendInvitation = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!focusedProject) return;
    setBusy(true);
    try {
      await apiRequest(`/api/projects/${focusedProject.projectId}/invitations`, {
        method: 'POST',
        body: JSON.stringify({
          email: inviteEmail.trim().toLowerCase(),
          projectRole: inviteRole,
          expiresInDays: Number(inviteDays) || 7,
        }),
      });
      onToast(
        'success',
        `Invitation sent to ${inviteEmail.trim()} as ${
          inviteRole === 'PROJECT_ADMIN' ? 'Project Admin' : 'Project Member'
        }.`
      );
      setInviteEmail('');
      await onRefresh();
    } catch (err) {
      onToast(
        'error',
        err instanceof Error ? err.message : 'Failed to send invitation'
      );
    } finally {
      setBusy(false);
    }
  };

  const handleAcceptInvitation = async (invitationId: string) => {
    setBusy(true);
    try {
      await apiRequest(`/api/invitations/${invitationId}/accept`, {
        method: 'POST',
      });
      onToast('success', 'Invitation accepted. Project added to your workspace.');
      await onRefresh();
    } catch (err) {
      onToast(
        'error',
        err instanceof Error ? err.message : 'Unable to accept invitation'
      );
    } finally {
      setBusy(false);
    }
  };

  const handleRevokeInvitation = async () => {
    if (!revokeInviteId) return;
    setBusy(true);
    try {
      await apiRequest(`/api/invitations/${revokeInviteId}/revoke`, {
        method: 'POST',
      });
      setRevokeInviteId(null);
      onToast('info', 'Pending invitation revoked.');
      await onRefresh();
    } catch (err) {
      onToast(
        'error',
        err instanceof Error ? err.message : 'Failed to revoke invitation'
      );
    } finally {
      setBusy(false);
    }
  };

  const handleUpdateMembership = async (
    projectId: string,
    membership: ProjectMembership,
    patch: Partial<{
      projectRole: ProjectRole;
      membershipStatus: 'Active' | 'Inactive';
    }>
  ) => {
    setBusy(true);
    try {
      await apiRequest(
        `/api/projects/${projectId}/memberships/${membership.membershipId}`,
        {
          method: 'PATCH',
          body: JSON.stringify(patch),
        }
      );
      onToast('success', 'Project membership updated.');
      await onRefresh();
    } catch (err) {
      onToast(
        'error',
        err instanceof Error ? err.message : 'Failed to update membership'
      );
    } finally {
      setBusy(false);
    }
  };

  const handleConfirmRemoveMembership = async () => {
    if (!removeTarget) return;
    setBusy(true);
    try {
      await apiRequest(
        `/api/projects/${removeTarget.projectId}/memberships/${removeTarget.membership.membershipId}`,
        { method: 'DELETE' }
      );
      setRemoveTarget(null);
      onToast(
        'info',
        'Project access removed. Historical work records remain intact.'
      );
      await onRefresh();
    } catch (err) {
      onToast(
        'error',
        err instanceof Error ? err.message : 'Failed to remove project access'
      );
      setRemoveTarget(null);
    } finally {
      setBusy(false);
    }
  };

  const handleTransferOwnership = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!focusedProject || !transferOwnerId) return;
    setBusy(true);
    try {
      await apiRequest(
        `/api/projects/${focusedProject.projectId}/transfer-ownership`,
        {
          method: 'POST',
          body: JSON.stringify({ newOwnerUserId: transferOwnerId }),
        }
      );
      setTransferOwnerId('');
      onToast('success', 'Project ownership transferred.');
      await onRefresh();
    } catch (err) {
      onToast(
        'error',
        err instanceof Error ? err.message : 'Ownership transfer failed'
      );
    } finally {
      setBusy(false);
    }
  };

  const eligibleInviteEmails = useMemo(() => {
    const q = memberSearch.trim().toLowerCase();
    return data.users.filter(
      (u) =>
        u.status === 'Active' &&
        (!q ||
          u.name.toLowerCase().includes(q) ||
          u.email.toLowerCase().includes(q))
    );
  }, [data.users, memberSearch]);

  const ownerCandidates = useMemo(
    () =>
      data.users.filter(
        (u) =>
          u.status === 'Active' &&
          (u.role === 'SUPER_ADMIN' || u.role === 'ADMIN') &&
          u.userId !== focusedProject?.ownerUserId
      ),
    [data.users, focusedProject?.ownerUserId]
  );

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4 border-b border-slate-200 pb-5">
        <div>
          <h1 className="font-display text-2xl font-bold tracking-tight text-slate-900">
            {isSuperAdmin ? 'All Projects' : 'My Projects'}
          </h1>
          <p className="mt-1 text-sm text-slate-600">
            {isSuperAdmin
              ? 'Global project directory, ownership governance, access management, and isolated configurations.'
              : canCreate
              ? 'Projects you created or administer with Project Admin access.'
              : 'Projects assigned to your account. Switch project context or accept new invitations below.'}
          </p>
        </div>

        {canCreate && (
          <button
            type="button"
            onClick={() => setShowCreateForm(!showCreateForm)}
            className="inline-flex items-center gap-2 rounded-lg bg-blue-700 px-4 py-2 text-sm font-semibold text-white shadow-xs transition-colors hover:bg-blue-800 whitespace-nowrap shrink-0"
          >
            <FolderPlus className="h-4 w-4" />
            <span>Create Project</span>
          </button>
        )}
      </div>

      {/* Pending Invitations Addressed to Caller */}
      {myPendingInvitations.length > 0 && (
        <section className="rounded-xl border border-blue-200 bg-blue-50/70 p-5 space-y-3">
          <div className="flex items-center gap-2">
            <MailPlus className="h-4 w-4 text-blue-700" />
            <h2 className="font-display text-sm font-semibold text-blue-950">
              Pending Project Invitations ({myPendingInvitations.length})
            </h2>
          </div>
          <div className="divide-y divide-blue-200/70">
            {myPendingInvitations.map((inv) => (
              <div
                key={inv.invitationId}
                className="flex flex-wrap items-center justify-between gap-3 py-2.5 text-xs"
              >
                <div>
                  <span className="font-semibold text-slate-900">
                    Project {inv.projectId}
                  </span>
                  <span className="mx-2 text-slate-400">·</span>
                  <span className="text-slate-700">
                    Role:{' '}
                    {inv.assignedProjectRole === 'PROJECT_ADMIN'
                      ? 'Project Admin'
                      : 'Project Member'}
                  </span>
                  <span className="mx-2 text-slate-400">·</span>
                  <span className="text-slate-600">
                    Invited by {inv.invitedBy} · Expires{' '}
                    {formatUtcInTimezone(
                      inv.expiresAt,
                      data.systemSettings.timezone
                    )}
                  </span>
                </div>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => handleAcceptInvitation(inv.invitationId)}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-blue-700 px-3.5 py-1.5 font-semibold text-white hover:bg-blue-800 disabled:opacity-60 whitespace-nowrap"
                >
                  <CheckCircle2 className="h-3.5 w-3.5" />
                  <span>Accept Invitation</span>
                </button>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Create Project Drawer */}
      {showCreateForm && canCreate && (
        <form
          onSubmit={handleCreateProject}
          className="rounded-xl border border-slate-300 bg-white p-6 shadow-sm space-y-4"
        >
          <div className="flex items-center justify-between">
            <h2 className="font-display text-base font-semibold text-slate-900">
              Create New Project
            </h2>
            <button
              type="button"
              onClick={() => setShowCreateForm(false)}
              className="rounded p-1 text-slate-400 hover:bg-slate-100"
            >
              <X className="h-4 w-4" />
            </button>
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <label className="block text-xs font-medium text-slate-700">
                Project Name *
              </label>
              <input
                type="text"
                required
                minLength={2}
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                placeholder="e.g., Core Payments Platform"
                className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-700">
                Initial Status *
              </label>
              <select
                value={newStatus}
                onChange={(e) => setNewStatus(e.target.value as ProjectStatus)}
                className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm"
              >
                <option value="Active">Active</option>
                <option value="Inactive">Inactive</option>
              </select>
            </div>

            <div className="sm:col-span-2">
              <label className="block text-xs font-medium text-slate-700">
                Project Description
              </label>
              <textarea
                rows={2}
                value={newDesc}
                onChange={(e) => setNewDesc(e.target.value)}
                placeholder="Scope, goals, and delivery focus..."
                className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
              />
            </div>

            <div className="sm:col-span-2">
              <label className="inline-flex items-center gap-2 text-xs text-slate-700">
                <input
                  type="checkbox"
                  checked={newUseOverride}
                  onChange={(e) => setNewUseOverride(e.target.checked)}
                  className="h-4 w-4 rounded border-slate-300 accent-blue-700"
                />
                <span>
                  Enable project-specific work logging field overrides immediately
                  (otherwise inherits Global Defaults)
                </span>
              </label>
            </div>
          </div>

          <div className="flex justify-end gap-2 border-t border-slate-100 pt-3">
            <button
              type="button"
              onClick={() => setShowCreateForm(false)}
              className="rounded-lg border border-slate-300 px-4 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={busy}
              className="rounded-lg bg-blue-700 px-4 py-2 text-xs font-semibold text-white hover:bg-blue-800 disabled:opacity-60"
            >
              {busy ? 'Creating...' : 'Create Project'}
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
            placeholder="Search projects by name, ID, or description..."
            className="w-full rounded-lg border border-slate-300 bg-white pl-8 pr-3 py-2 text-xs"
          />
        </div>
        <select
          aria-label="Filter projects by status"
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs"
        >
          <option value="">All Statuses</option>
          <option value="Active">Active</option>
          <option value="Inactive">Inactive</option>
          <option value="Archived">Archived</option>
        </select>
      </div>

      {/* Main Split: Project Directory + Selected Project Workspace/Access */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        {/* Project Cards List */}
        <div className="rounded-xl border border-slate-200 bg-white divide-y divide-slate-100 self-start overflow-hidden">
          <div className="px-4 py-3 border-b border-slate-200 bg-slate-50/70 font-display text-xs font-semibold text-slate-700">
            Authorized Projects ({filteredProjects.length})
          </div>
          {filteredProjects.length === 0 ? (
            <div className="p-8 text-center text-sm text-slate-500">
              {canCreate
                ? 'No projects match your filter. Create a project to get started.'
                : 'No projects are assigned to your account yet.'}
            </div>
          ) : (
            filteredProjects.map((p) => {
              const isSelected = focusedProject?.projectId === p.projectId;
              return (
                <div
                  key={p.projectId}
                  onClick={() => {
                    setSelectedProjectId(p.projectId);
                    onSelectProjectContext(p.projectId);
                  }}
                  className={`cursor-pointer p-4 space-y-2 transition-colors ${
                    isSelected ? 'bg-blue-50/60' : 'hover:bg-slate-50'
                  }`}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="font-mono text-[11px] text-slate-400">
                        {p.projectId}
                      </p>
                      <h3 className="truncate font-display text-sm font-semibold text-slate-900">
                        {p.name}
                      </h3>
                    </div>
                    <StatusText status={p.status} />
                  </div>
                  <p className="text-xs text-slate-600 line-clamp-2">
                    {p.description || 'No description provided.'}
                  </p>
                  <div className="flex flex-wrap items-center gap-2 text-[11px] text-slate-500">
                    <span>Owner: {p.ownerName}</span>
                    <span aria-hidden="true">·</span>
                    <span className="font-mono tabular-nums">
                      {p.adminCount + p.memberCount} members
                    </span>
                    <span aria-hidden="true">·</span>
                    <span className="font-mono tabular-nums">
                      {p.totalEntries} entries
                    </span>
                  </div>
                </div>
              );
            })
          )}
        </div>

        {/* Project Detail & Manage Access */}
        <div className="lg:col-span-2 space-y-5">
          {!focusedProject ? (
            <div className="rounded-xl border border-slate-200 bg-white p-10 text-center text-sm text-slate-500">
              Select a project to inspect activity, team access, or configuration.
            </div>
          ) : (
            <div className="rounded-xl border border-slate-200 bg-white shadow-xs overflow-hidden">
              {/* Project Header */}
              <div className="border-b border-slate-200 p-6 space-y-4">
                <div className="flex flex-wrap items-start justify-between gap-4">
                  <div>
                    <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500">
                      <span className="font-mono">{focusedProject.projectId}</span>
                      <span aria-hidden="true">·</span>
                      <StatusText status={focusedProject.status} />
                      <span aria-hidden="true">·</span>
                      <span>
                        Your Access:{' '}
                        <strong className="text-slate-800">
                          {isSuperAdmin
                            ? 'Super Admin'
                            : focusedProject.callerProjectRole === 'PROJECT_ADMIN'
                            ? 'Project Admin'
                            : 'Project Member'}
                        </strong>
                      </span>
                    </div>
                    <h2 className="mt-1.5 font-display text-xl font-bold text-slate-900">
                      {focusedProject.name}
                    </h2>
                    <p className="mt-1 text-sm text-slate-600">
                      {focusedProject.description || 'No project description.'}
                    </p>
                  </div>

                  {focusedProject.canManage && !isPreviewMode && (
                    <div className="flex flex-wrap items-center gap-2">
                      {onOpenProjectConfig && (
                        <button
                          type="button"
                          onClick={() =>
                            onOpenProjectConfig(focusedProject.projectId)
                          }
                          className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 whitespace-nowrap"
                        >
                          <Sliders className="h-3.5 w-3.5" />
                          <span>Project Form Config</span>
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={() => {
                          setEditingProject(focusedProject);
                          setEditName(focusedProject.name);
                          setEditDesc(focusedProject.description);
                          setEditStatus(focusedProject.status);
                        }}
                        className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 whitespace-nowrap"
                      >
                        <Settings2 className="h-3.5 w-3.5" />
                        <span>Project Settings</span>
                      </button>
                    </div>
                  )}
                </div>

                {/* Sub-navigation inside Project Inspector */}
                {focusedProject.canManage && !isPreviewMode && (
                  <div className="flex items-center gap-1 rounded-lg bg-slate-100 p-1 w-fit">
                    <button
                      type="button"
                      onClick={() => setDetailTab('overview')}
                      className={`rounded-md px-3 py-1.5 text-xs font-medium transition-colors whitespace-nowrap ${
                        detailTab === 'overview'
                          ? 'bg-white text-slate-900 shadow-xs'
                          : 'text-slate-600 hover:text-slate-900'
                      }`}
                    >
                      Project Summary
                    </button>
                    <button
                      type="button"
                      onClick={() => setDetailTab('access')}
                      className={`rounded-md px-3 py-1.5 text-xs font-medium transition-colors whitespace-nowrap ${
                        detailTab === 'access'
                          ? 'bg-white text-slate-900 shadow-xs'
                          : 'text-slate-600 hover:text-slate-900'
                      }`}
                    >
                      Manage Access ({focusedMemberships.length})
                    </button>
                  </div>
                )}
              </div>

              {/* Project Summary Tab */}
              {(detailTab === 'overview' ||
                !focusedProject.canManage ||
                isPreviewMode) && (
                <div className="p-6 space-y-6">
                  <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
                    <div>
                      <p className="text-xs text-slate-500">Total Entries</p>
                      <p className="mt-1 font-mono text-xl font-semibold text-slate-900 tabular-nums">
                        {focusedProject.totalEntries}
                      </p>
                    </div>
                    <div>
                      <p className="text-xs text-slate-500">Completed</p>
                      <p className="mt-1 font-mono text-xl font-semibold text-emerald-700 tabular-nums">
                        {focusedProject.completedEntries}
                      </p>
                    </div>
                    <div>
                      <p className="text-xs text-slate-500">In Progress</p>
                      <p className="mt-1 font-mono text-xl font-semibold text-amber-700 tabular-nums">
                        {focusedProject.inProgressEntries}
                      </p>
                    </div>
                    <div>
                      <p className="text-xs text-slate-500">Blocked</p>
                      <p className="mt-1 font-mono text-xl font-semibold text-red-700 tabular-nums">
                        {focusedProject.blockedEntries}
                      </p>
                    </div>
                  </div>

                  <dl className="grid grid-cols-1 gap-4 border-t border-slate-100 pt-4 text-xs sm:grid-cols-3">
                    <div>
                      <dt className="text-slate-500">Project Owner</dt>
                      <dd className="mt-1 font-medium text-slate-900">
                        {focusedProject.ownerName}
                      </dd>
                    </div>
                    <div>
                      <dt className="text-slate-500">Logging Config</dt>
                      <dd className="mt-1 font-medium text-slate-900">
                        {focusedProject.useProjectConfig
                          ? `Project Override (v${focusedProject.activeConfigVersion})`
                          : `Global Defaults (v${data.systemSettings.activeConfigVersion})`}
                      </dd>
                    </div>
                    <div>
                      <dt className="text-slate-500">Created</dt>
                      <dd className="mt-1 font-mono text-slate-700">
                        {formatUtcInTimezone(
                          focusedProject.createdAt,
                          data.systemSettings.timezone
                        )}
                      </dd>
                    </div>
                  </dl>
                </div>
              )}

              {/* Manage Access Tab (Project Settings -> Manage Access) */}
              {detailTab === 'access' &&
                focusedProject.canManage &&
                !isPreviewMode && (
                  <div className="p-6 space-y-6">
                    {/* Invite Member / Invite Admin Form */}
                    <form
                      onSubmit={handleSendInvitation}
                      className="rounded-lg border border-slate-200 bg-slate-50/60 p-4 space-y-3"
                    >
                      <div className="flex items-center justify-between">
                        <h3 className="font-display text-sm font-semibold text-slate-900">
                          Invite Member or Project Admin
                        </h3>
                        <span className="text-[11px] text-slate-500">
                          Project Admin applies only to existing Admins/Super Admins
                        </span>
                      </div>

                      <div className="grid grid-cols-1 gap-3 sm:grid-cols-4">
                        <div className="sm:col-span-2">
                          <input
                            type="email"
                            required
                            list={`invite-candidates-${focusedProject.projectId}`}
                            value={inviteEmail}
                            onChange={(e) => setInviteEmail(e.target.value)}
                            placeholder="colleague@company.com"
                            className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs"
                          />
                          <datalist
                            id={`invite-candidates-${focusedProject.projectId}`}
                          >
                            {eligibleInviteEmails.map((u) => (
                              <option key={u.userId} value={u.email}>
                                {u.name} ({u.role})
                              </option>
                            ))}
                          </datalist>
                        </div>

                        <select
                          aria-label="Project role for invitation"
                          value={inviteRole}
                          onChange={(e) =>
                            setInviteRole(e.target.value as ProjectRole)
                          }
                          className="rounded-lg border border-slate-300 bg-white px-2.5 py-2 text-xs"
                        >
                          <option value="PROJECT_MEMBER">
                            Invite Member (PROJECT_MEMBER)
                          </option>
                          <option value="PROJECT_ADMIN">
                            Invite Admin (PROJECT_ADMIN)
                          </option>
                        </select>

                        <div className="flex gap-2">
                          <select
                            aria-label="Invitation expiration"
                            value={inviteDays}
                            onChange={(e) => setInviteDays(e.target.value)}
                            className="rounded-lg border border-slate-300 bg-white px-2 py-2 text-xs"
                          >
                            <option value="3">3d expiry</option>
                            <option value="7">7d expiry</option>
                            <option value="14">14d expiry</option>
                            <option value="30">30d expiry</option>
                          </select>
                          <button
                            type="submit"
                            disabled={busy}
                            className="flex-1 rounded-lg bg-blue-700 px-3 py-2 text-xs font-semibold text-white hover:bg-blue-800 disabled:opacity-60 whitespace-nowrap"
                          >
                            Send Invite
                          </button>
                        </div>
                      </div>
                    </form>

                    {/* Active & Inactive Project Memberships */}
                    <div className="space-y-2.5">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <h3 className="font-display text-sm font-semibold text-slate-900 flex items-center gap-1.5">
                          <Users className="h-4 w-4 text-slate-500" />
                          <span>
                            Project Memberships ({focusedMemberships.length})
                          </span>
                        </h3>
                        <input
                          type="text"
                          value={memberSearch}
                          onChange={(e) => setMemberSearch(e.target.value)}
                          placeholder="Filter memberships..."
                          className="rounded-md border border-slate-300 px-2.5 py-1 text-xs"
                        />
                      </div>

                      <div className="overflow-x-auto rounded-lg border border-slate-200">
                        <table className="w-full text-left text-xs">
                          <thead className="border-b border-slate-200 bg-slate-50 text-slate-500">
                            <tr>
                              <th className="px-3.5 py-2.5 font-medium">User</th>
                              <th className="px-3.5 py-2.5 font-medium">
                                Global Role
                              </th>
                              <th className="px-3.5 py-2.5 font-medium">
                                Project Role
                              </th>
                              <th className="px-3.5 py-2.5 font-medium">
                                Status
                              </th>
                              <th className="px-3.5 py-2.5 font-medium">
                                Actions
                              </th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-slate-100">
                            {focusedMemberships
                              .filter((m) => {
                                if (!memberSearch.trim()) return true;
                                const u = userMap.get(m.userId);
                                const q = memberSearch.toLowerCase();
                                return (
                                  (u?.name || '').toLowerCase().includes(q) ||
                                  (u?.email || '').toLowerCase().includes(q)
                                );
                              })
                              .map((m) => {
                                const u = userMap.get(m.userId);
                                const isOwner =
                                  focusedProject.ownerUserId === m.userId;
                                return (
                                  <tr key={m.membershipId}>
                                    <td className="px-3.5 py-2.5">
                                      <div className="font-medium text-slate-900">
                                        {u?.name || m.userId}
                                        {isOwner && (
                                          <span className="ml-1.5 text-[11px] font-semibold text-blue-700">
                                            Owner
                                          </span>
                                        )}
                                      </div>
                                      {u?.email && (
                                        <div className="font-mono text-[11px] text-slate-500">
                                          {u.email}
                                        </div>
                                      )}
                                    </td>
                                    <td className="px-3.5 py-2.5 font-mono text-slate-600">
                                      {u?.role || '—'}
                                    </td>
                                    <td className="px-3.5 py-2.5">
                                      <select
                                        aria-label={`Project role for ${u?.name || m.userId}`}
                                        disabled={
                                          busy ||
                                          (u?.role === 'MEMBER' &&
                                            m.projectRole === 'PROJECT_MEMBER')
                                        }
                                        value={m.projectRole}
                                        onChange={(e) =>
                                          handleUpdateMembership(
                                            focusedProject.projectId,
                                            m,
                                            {
                                              projectRole: e.target
                                                .value as ProjectRole,
                                            }
                                          )
                                        }
                                        className="rounded border border-slate-300 bg-white px-2 py-1 text-xs"
                                      >
                                        <option value="PROJECT_MEMBER">
                                          PROJECT_MEMBER
                                        </option>
                                        {u?.role !== 'MEMBER' && (
                                          <option value="PROJECT_ADMIN">
                                            PROJECT_ADMIN
                                          </option>
                                        )}
                                      </select>
                                    </td>
                                    <td className="px-3.5 py-2.5">
                                      <StatusText status={m.membershipStatus} />
                                    </td>
                                    <td className="px-3.5 py-2.5">
                                      <div className="flex items-center gap-2.5">
                                        <button
                                          type="button"
                                          disabled={busy}
                                          onClick={() =>
                                            handleUpdateMembership(
                                              focusedProject.projectId,
                                              m,
                                              {
                                                membershipStatus:
                                                  m.membershipStatus === 'Active'
                                                    ? 'Inactive'
                                                    : 'Active',
                                              }
                                            )
                                          }
                                          className="font-medium text-slate-600 hover:text-slate-900 hover:underline whitespace-nowrap"
                                        >
                                          {m.membershipStatus === 'Active'
                                            ? 'Deactivate'
                                            : 'Activate'}
                                        </button>
                                        <button
                                          type="button"
                                          disabled={busy}
                                          onClick={() =>
                                            setRemoveTarget({
                                              projectId: focusedProject.projectId,
                                              membership: m,
                                              userName: u?.name || m.userId,
                                            })
                                          }
                                          className="text-red-700 hover:underline whitespace-nowrap inline-flex items-center gap-1"
                                        >
                                          <Trash2 className="h-3 w-3" />
                                          <span>Remove</span>
                                        </button>
                                      </div>
                                    </td>
                                  </tr>
                                );
                              })}
                          </tbody>
                        </table>
                      </div>
                    </div>

                    {/* Invitations Ledger for This Project */}
                    <div className="space-y-2">
                      <h3 className="font-display text-sm font-semibold text-slate-900 flex items-center gap-1.5">
                        <UserCheck className="h-4 w-4 text-slate-500" />
                        <span>Project Invitations ({focusedInvitations.length})</span>
                      </h3>
                      {focusedInvitations.length === 0 ? (
                        <p className="text-xs text-slate-500">
                          No invitations issued for this project yet.
                        </p>
                      ) : (
                        <div className="overflow-x-auto rounded-lg border border-slate-200">
                          <table className="w-full text-left text-xs">
                            <thead className="border-b border-slate-200 bg-slate-50 text-slate-500">
                              <tr>
                                <th className="px-3.5 py-2 font-medium">
                                  Invitee Email
                                </th>
                                <th className="px-3.5 py-2 font-medium">Role</th>
                                <th className="px-3.5 py-2 font-medium">Status</th>
                                <th className="px-3.5 py-2 font-medium">
                                  Expires
                                </th>
                                <th className="px-3.5 py-2 font-medium">
                                  Action
                                </th>
                              </tr>
                            </thead>
                            <tbody className="divide-y divide-slate-100">
                              {focusedInvitations.map((inv) => (
                                <tr key={inv.invitationId}>
                                  <td className="px-3.5 py-2 font-mono text-slate-800">
                                    {inv.inviteeEmail}
                                  </td>
                                  <td className="px-3.5 py-2">
                                    {inv.assignedProjectRole}
                                  </td>
                                  <td className="px-3.5 py-2">
                                    <StatusText status={inv.invitationStatus} />
                                  </td>
                                  <td className="px-3.5 py-2 font-mono text-slate-500">
                                    {formatUtcInTimezone(
                                      inv.expiresAt,
                                      data.systemSettings.timezone
                                    )}
                                  </td>
                                  <td className="px-3.5 py-2">
                                    {inv.invitationStatus === 'Pending' ? (
                                      <button
                                        type="button"
                                        onClick={() =>
                                          setRevokeInviteId(inv.invitationId)
                                        }
                                        className="font-medium text-red-700 hover:underline"
                                      >
                                        Revoke
                                      </button>
                                    ) : (
                                      <span className="text-slate-400">—</span>
                                    )}
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      )}
                    </div>

                    {/* Transfer Project Ownership (Super Admin Only) */}
                    {isSuperAdmin && (
                      <form
                        onSubmit={handleTransferOwnership}
                        className="rounded-lg border border-slate-200 bg-slate-50/70 p-4 space-y-3"
                      >
                        <div className="flex items-center gap-2">
                          <KeyRound className="h-4 w-4 text-slate-600" />
                          <h3 className="font-display text-sm font-semibold text-slate-900">
                            Transfer Project Ownership (Super Admin)
                          </h3>
                        </div>
                        <p className="text-xs text-slate-600">
                          Transfers primary ownership to another active Admin or
                          Super Admin and grants them Project Admin privileges.
                        </p>
                        <div className="flex flex-wrap gap-2">
                          <select
                            required
                            value={transferOwnerId}
                            onChange={(e) => setTransferOwnerId(e.target.value)}
                            className="flex-1 min-w-[200px] rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs"
                          >
                            <option value="">Select new Project Owner...</option>
                            {ownerCandidates.map((u) => (
                              <option key={u.userId} value={u.userId}>
                                {u.name} ({u.email} · {u.role})
                              </option>
                            ))}
                          </select>
                          <button
                            type="submit"
                            disabled={busy || !transferOwnerId}
                            className="rounded-lg bg-slate-900 px-4 py-2 text-xs font-semibold text-white hover:bg-slate-800 disabled:opacity-50 whitespace-nowrap"
                          >
                            Transfer Ownership
                          </button>
                        </div>
                      </form>
                    )}
                  </div>
                )}
            </div>
          )}
        </div>
      </div>

      {/* Project Edit Modal */}
      {editingProject && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/45 px-4"
          role="dialog"
          aria-modal="true"
        >
          <form
            onSubmit={handleSaveProjectEdit}
            className="w-full max-w-md rounded-xl border border-slate-200 bg-white p-6 shadow-xl space-y-4"
          >
            <div className="flex items-center justify-between">
              <h3 className="font-display text-base font-semibold text-slate-900 flex items-center gap-2">
                <Shield className="h-4 w-4 text-slate-600" />
                <span>Project Settings ({editingProject.projectId})</span>
              </h3>
              <button
                type="button"
                onClick={() => setEditingProject(null)}
                className="rounded p-1 text-slate-400 hover:bg-slate-100"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-700">
                Project Name *
              </label>
              <input
                type="text"
                required
                minLength={2}
                value={editName}
                onChange={(e) => setEditName(e.target.value)}
                className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-700">
                Description
              </label>
              <textarea
                rows={3}
                value={editDesc}
                onChange={(e) => setEditDesc(e.target.value)}
                className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-700">
                Project Status
              </label>
              <select
                value={editStatus}
                onChange={(e) => setEditStatus(e.target.value as ProjectStatus)}
                className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm"
              >
                <option value="Active">Active</option>
                <option value="Inactive">Inactive</option>
                {(isSuperAdmin ||
                  editingProject.ownerUserId === data.currentUser.userId) && (
                  <option value="Archived">Archived</option>
                )}
              </select>
            </div>

            <div className="flex justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setEditingProject(null)}
                className="rounded-lg border border-slate-300 px-4 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={busy}
                className="rounded-lg bg-blue-700 px-4 py-2 text-xs font-semibold text-white hover:bg-blue-800 disabled:opacity-60"
              >
                {busy ? 'Saving...' : 'Save Settings'}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Confirmation Dialogs */}
      <ConfirmDialog
        open={!!removeTarget}
        title="Remove Project Access"
        description={`Remove ${removeTarget?.userName} from this project? They will immediately lose access to project views and logging, while historical work records remain preserved.`}
        confirmLabel="Remove Access"
        tone="danger"
        busy={busy}
        onConfirm={handleConfirmRemoveMembership}
        onCancel={() => setRemoveTarget(null)}
      />

      <ConfirmDialog
        open={!!revokeInviteId}
        title="Revoke Pending Invitation"
        description="Revoking this invitation prevents the recipient from accepting it."
        confirmLabel="Revoke Invitation"
        tone="danger"
        busy={busy}
        onConfirm={handleRevokeInvitation}
        onCancel={() => setRevokeInviteId(null)}
      />
    </div>
  );
};
