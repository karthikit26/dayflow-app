import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  BarChart3,
  Briefcase,
  ClipboardList,
  Eye,
  FolderKanban,
  History,
  LayoutDashboard,
  LogOut,
  MailPlus,
  Menu,
  RefreshCw,
  Settings,
  ShieldCheck,
  Sliders,
  User as UserIcon,
  Users,
  X,
} from 'lucide-react';
import type { User } from 'firebase/auth';
import {
  ApiError,
  fetchBootstrap,
  type BootstrapPayload,
} from './lib/api';
import {
  formatGoogleAuthError,
  initAuthListener,
  logoutWorkspace,
  signInWithGoogleWorkspace,
} from './lib/firebase';
import { SignInView } from './components/SignInView';
import {
  MemberProfileScreen,
  MyHistoryScreen,
  MyWorkScreen,
  TeamOverviewScreen,
  type MemberTab,
} from './components/MemberViews';
import { ProjectsScreen } from './components/ProjectWorkspaceViews';
import {
  AdminOverviewScreen,
  AdminSprintOverviewScreen,
  AdminTeamWorkScreen,
  AdminUsersScreen,
} from './components/AdminOpsViews';
import {
  AdminAuditLogsScreen,
  AdminReportsScreen,
  AdminSettingsScreen,
  AdminWorkConfigScreen,
} from './components/AdminGovernanceViews';
import { ToastViewport, type ToastItem } from './components/Toast';

type AdminTab =
  | 'overview'
  | 'projects'
  | 'users'
  | 'team-work'
  | 'sprint-overview'
  | 'reports'
  | 'work-config'
  | 'audit-logs'
  | 'settings';

const SUPER_ADMIN_NAV: Array<{
  id: AdminTab;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
}> = [
  { id: 'overview', label: 'Overview', icon: LayoutDashboard },
  { id: 'projects', label: 'Projects', icon: Briefcase },
  { id: 'users', label: 'Users', icon: Users },
  { id: 'reports', label: 'Reports', icon: BarChart3 },
  { id: 'work-config', label: 'Work Configuration', icon: Sliders },
  { id: 'audit-logs', label: 'Audit Logs', icon: ShieldCheck },
  { id: 'settings', label: 'Settings', icon: Settings },
];

const ADMIN_NAV: Array<{
  id: AdminTab;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
}> = [
  { id: 'overview', label: 'Overview', icon: LayoutDashboard },
  { id: 'projects', label: 'My Projects', icon: Briefcase },
  { id: 'users', label: 'Team Members', icon: Users },
  { id: 'team-work', label: 'Team Work', icon: ClipboardList },
  { id: 'sprint-overview', label: 'Sprint Overview', icon: FolderKanban },
  { id: 'reports', label: 'Reports', icon: BarChart3 },
  { id: 'work-config', label: 'Work Configuration', icon: Sliders },
];

const MEMBER_NAV: Array<{
  id: MemberTab;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
}> = [
  { id: 'my-work', label: 'My Work', icon: ClipboardList },
  { id: 'my-projects', label: 'My Projects', icon: Briefcase },
  { id: 'my-history', label: 'My History', icon: History },
  { id: 'team-overview', label: 'Team Overview', icon: Users },
  { id: 'profile', label: 'Profile', icon: UserIcon },
];

export default function App() {
  const [authReady, setAuthReady] = useState(false);
  const [firebaseUser, setFirebaseUser] = useState<User | null>(null);
  const [authBusy, setAuthBusy] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);

  const [bootstrap, setBootstrap] = useState<BootstrapPayload | null>(null);
  const [loadingData, setLoadingData] = useState(false);

  const [adminTab, setAdminTab] = useState<AdminTab>('overview');
  const [memberTab, setMemberTab] = useState<MemberTab>('my-work');
  const [isPreviewMode, setIsPreviewMode] = useState(false);
  const [activeProjectId, setActiveProjectId] = useState<string>('');
  const [configProjectScope, setConfigProjectScope] = useState<string>('');
  const [selectedWorkDate, setSelectedWorkDate] = useState('');
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  const [toasts, setToasts] = useState<ToastItem[]>([]);

  const pushToast = useCallback(
    (tone: 'success' | 'error' | 'info', message: string) => {
      const id = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
      setToasts((prev) => [...prev.slice(-3), { id, tone, message }]);
      window.setTimeout(() => {
        setToasts((prev) => prev.filter((t) => t.id !== id));
      }, 4500);
    },
    []
  );

  const dismissToast = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const loadBootstrap = useCallback(async () => {
    setLoadingData(true);
    try {
      const payload = await fetchBootstrap();
      setBootstrap(payload);
      setAuthError(null);
      setSelectedWorkDate((prev) => prev || payload.todayInTz);
      setActiveProjectId((prev) =>
        prev && payload.projects.some((p) => p.projectId === prev) ? prev : ''
      );
    } catch (err) {
      if (err instanceof ApiError && (err.status === 401 || err.status === 403)) {
        setAuthError(err.message);
        setBootstrap(null);
        await logoutWorkspace();
      } else {
        setAuthError(
          err instanceof Error ? err.message : 'Unable to reach DayFlow server.'
        );
      }
    } finally {
      setLoadingData(false);
    }
  }, []);

  useEffect(() => {
    const unsub = initAuthListener((user) => {
      setFirebaseUser(user);
      setAuthReady(true);
      if (user) {
        void loadBootstrap();
      } else {
        setBootstrap(null);
        setIsPreviewMode(false);
        setActiveProjectId('');
      }
    });
    return unsub;
  }, [loadBootstrap]);

  const handleGoogleSignIn = async () => {
    setAuthBusy(true);
    setAuthError(null);
    try {
      const { user } = await signInWithGoogleWorkspace();
      setFirebaseUser(user);
      setAuthReady(true);
      await loadBootstrap();
    } catch (err) {
      setAuthError(formatGoogleAuthError(err));
    } finally {
      setAuthBusy(false);
    }
  };

  const handleSignOut = async () => {
    setBootstrap(null);
    setFirebaseUser(null);
    setIsPreviewMode(false);
    setActiveProjectId('');
    setConfigProjectScope('');
    setSelectedWorkDate('');
    setAdminTab('overview');
    setMemberTab('my-work');
    setAuthError(null);
    await logoutWorkspace();
  };

  const pendingInvitesCount = useMemo(() => {
    if (!bootstrap) return 0;
    const email = bootstrap.currentUser.email.toLowerCase();
    return bootstrap.projectInvitations.filter(
      (inv) =>
        inv.inviteeEmail.toLowerCase() === email &&
        inv.invitationStatus === 'Pending'
    ).length;
  }, [bootstrap]);

  if (!authReady) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-50 text-sm text-slate-600">
        Initializing DayFlow...
      </div>
    );
  }

  if (!firebaseUser || !bootstrap) {
    if (firebaseUser && loadingData && !authError) {
      return (
        <div className="flex min-h-screen items-center justify-center bg-slate-50 p-6">
          <div className="w-full max-w-md space-y-4 rounded-xl border border-slate-200 bg-white p-6 shadow-xs">
            <div className="h-4 w-32 animate-pulse rounded bg-slate-200" />
            <div className="h-3 w-full animate-pulse rounded bg-slate-100" />
            <div className="h-3 w-2/3 animate-pulse rounded bg-slate-100" />
            <p className="pt-2 text-xs text-slate-500">
              Loading your DayFlow workspace...
            </p>
          </div>
        </div>
      );
    }
    return (
      <SignInView
        loading={authBusy || loadingData}
        error={authError}
        onSignIn={handleGoogleSignIn}
      />
    );
  }

  const role = bootstrap.currentUser.role;
  const isSuperAdmin = role === 'SUPER_ADMIN';
  const isAdminOrSuperAdmin = isSuperAdmin || role === 'ADMIN';
  const showMemberExperience = !isAdminOrSuperAdmin || isPreviewMode;

  const activeAdminNav = isSuperAdmin ? SUPER_ADMIN_NAV : ADMIN_NAV;
  const effectiveAdminTab = activeAdminNav.some((item) => item.id === adminTab)
    ? adminTab
    : 'overview';

  const togglePreviewMode = () => {
    if (!isAdminOrSuperAdmin) return;
    setIsPreviewMode((prev) => {
      const next = !prev;
      if (next) setMemberTab('my-work');
      return next;
    });
    setMobileMenuOpen(false);
  };

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900 flex">
      {/* Mobile Sidebar Backdrop */}
      {mobileMenuOpen && (
        <div
          className="fixed inset-0 z-30 bg-slate-900/40 backdrop-blur-[1px] lg:hidden"
          onClick={() => setMobileMenuOpen(false)}
        />
      )}

      {/* Left Sidebar Navigation */}
      <aside
        className={`fixed inset-y-0 left-0 z-40 flex w-64 flex-col border-r border-slate-200 bg-white transition-transform lg:static lg:translate-x-0 ${
          mobileMenuOpen ? 'translate-x-0' : '-translate-x-full'
        }`}
      >
        <div className="flex h-14 items-center justify-between border-b border-slate-200 px-5">
          <div className="flex items-center gap-2.5 min-w-0">
            <img
              src="/assets/aistudio/Glowing_Sunrise_Waves_with_Checkmark_36f8e522.png"
              alt="DayFlow"
              className="h-8 w-8 shrink-0 rounded-lg object-cover shadow-xs"
            />
            <div className="truncate">
              <span className="font-display text-sm font-bold tracking-tight text-slate-900">
                DayFlow
              </span>
            </div>
          </div>
          <button
            type="button"
            onClick={() => setMobileMenuOpen(false)}
            className="rounded p-1 text-slate-400 hover:bg-slate-100 lg:hidden"
            aria-label="Close navigation"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="px-4 py-3 border-b border-slate-100">
          <p className="truncate text-xs font-semibold text-slate-800">
            {bootstrap.systemSettings.companyName}
          </p>
          <p className="mt-0.5 text-[11px] text-slate-500">
            {showMemberExperience && isAdminOrSuperAdmin
              ? 'Member Preview Workspace'
              : isSuperAdmin
              ? 'Super Admin Governance'
              : role === 'ADMIN'
              ? 'Project Admin Workspace'
              : 'Member Workspace'}
          </p>
        </div>

        <nav className="flex-1 space-y-1 px-3 py-4 overflow-y-auto">
          {showMemberExperience
            ? MEMBER_NAV.map((item) => {
                const Icon = item.icon;
                const active = memberTab === item.id;
                return (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => {
                      setMemberTab(item.id);
                      setMobileMenuOpen(false);
                    }}
                    className={`flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-left text-sm font-medium transition-colors whitespace-nowrap ${
                      active
                        ? 'bg-blue-50 text-blue-800'
                        : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900'
                    }`}
                  >
                    <Icon className="h-4 w-4 shrink-0" />
                    <span>{item.label}</span>
                  </button>
                );
              })
            : activeAdminNav.map((item) => {
                const Icon = item.icon;
                const active = effectiveAdminTab === item.id;
                return (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => {
                      setAdminTab(item.id);
                      setMobileMenuOpen(false);
                    }}
                    className={`flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-left text-sm font-medium transition-colors whitespace-nowrap ${
                      active
                        ? 'bg-blue-50 text-blue-800'
                        : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900'
                    }`}
                  >
                    <Icon className="h-4 w-4 shrink-0" />
                    <span>{item.label}</span>
                  </button>
                );
              })}
        </nav>

        {/* Admin/SuperAdmin Member Preview Switch & Sign Out */}
        <div className="border-t border-slate-200 p-3 space-y-2">
          {isAdminOrSuperAdmin && (
            <button
              type="button"
              onClick={togglePreviewMode}
              className={`flex w-full items-center justify-center gap-2 rounded-lg border px-3 py-2 text-xs font-semibold transition-colors whitespace-nowrap ${
                isPreviewMode
                  ? 'border-amber-300 bg-amber-50 text-amber-900 hover:bg-amber-100'
                  : 'border-slate-300 bg-white text-slate-700 hover:bg-slate-50'
              }`}
            >
              <Eye className="h-3.5 w-3.5 shrink-0" />
              <span>
                {isPreviewMode ? 'Exit Member Preview' : 'Preview Member View'}
              </span>
            </button>
          )}

          <button
            type="button"
            onClick={handleSignOut}
            className="flex w-full items-center justify-center gap-2 rounded-lg px-3 py-2 text-xs font-medium text-slate-600 hover:bg-slate-100 hover:text-slate-900 whitespace-nowrap"
          >
            <LogOut className="h-3.5 w-3.5 shrink-0" />
            <span>Sign Out</span>
          </button>
        </div>
      </aside>

      {/* Main Content Area */}
      <div className="flex min-w-0 flex-1 flex-col">
        {/* Top Member Preview Mode Banner */}
        {isAdminOrSuperAdmin && isPreviewMode && (
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-amber-200 bg-amber-50 px-6 py-2.5 text-xs text-amber-900">
            <div>
              <span className="font-semibold">
                Preview Mode — Testing Member Experience.
              </span>{' '}
              Entries and submissions here are simulated locally without writing
              real Member work data or altering your {role} role.
            </div>
            <button
              type="button"
              onClick={togglePreviewMode}
              className="rounded-md border border-amber-300 bg-white px-2.5 py-1 font-semibold text-amber-900 hover:bg-amber-100 whitespace-nowrap shrink-0"
            >
              Return to {isSuperAdmin ? 'Super Admin' : 'Admin'} Workspace
            </button>
          </div>
        )}

        {/* Top Bar Contract (Timezone, Project Switcher, Actions & Profile) */}
        <header className="sticky top-0 z-20 flex h-14 items-center justify-between gap-4 border-b border-slate-200 bg-white/95 px-6 backdrop-blur-sm">
          <div className="flex items-center gap-3 min-w-0">
            <button
              type="button"
              onClick={() => setMobileMenuOpen(true)}
              className="rounded p-1.5 text-slate-500 hover:bg-slate-100 lg:hidden"
              aria-label="Open navigation"
            >
              <Menu className="h-5 w-5" />
            </button>
            <div className="flex items-center gap-2 text-xs text-slate-600 truncate">
              <span className="font-mono tabular-nums font-medium text-slate-900">
                {bootstrap.todayInTz}
              </span>
              <span className="font-mono tabular-nums text-slate-400">
                {bootstrap.timeInTz}
              </span>
              <span aria-hidden="true" className="hidden sm:inline text-slate-300">
                ·
              </span>
              <span className="hidden md:inline truncate">
                {bootstrap.systemSettings.timezone}
              </span>
            </div>
          </div>

          <div className="flex items-center gap-3 shrink-0">
            {/* Interactive Project Switcher */}
            <div className="flex items-center gap-1.5">
              <Briefcase
                className="hidden sm:block h-3.5 w-3.5 text-slate-400"
                aria-hidden="true"
              />
              <select
                aria-label="Active workspace project switcher"
                value={activeProjectId}
                onChange={(e) => setActiveProjectId(e.target.value)}
                className="max-w-[180px] sm:max-w-[230px] rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-xs font-medium text-slate-800 hover:border-slate-400 focus:border-blue-600 focus:outline-none"
              >
                <option value="">
                  {isSuperAdmin ? 'All Projects' : 'All Authorized Projects'}
                </option>
                {bootstrap.projects.map((p) => (
                  <option key={p.projectId} value={p.projectId}>
                    {p.name}
                    {p.status !== 'Active' ? ` (${p.status})` : ''}
                  </option>
                ))}
              </select>
            </div>

            {pendingInvitesCount > 0 && (
              <button
                type="button"
                onClick={() => {
                  if (showMemberExperience) setMemberTab('my-projects');
                  else setAdminTab('projects');
                }}
                className="inline-flex items-center gap-1.5 rounded-lg border border-blue-200 bg-blue-50 px-2.5 py-1.5 text-xs font-semibold text-blue-800 hover:bg-blue-100 whitespace-nowrap shrink-0"
              >
                <MailPlus className="h-3.5 w-3.5" />
                <span>
                  {pendingInvitesCount} Invite
                  {pendingInvitesCount === 1 ? '' : 's'}
                </span>
              </button>
            )}

            <button
              type="button"
              onClick={() => void loadBootstrap()}
              disabled={loadingData}
              className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50 whitespace-nowrap shrink-0"
              title="Refresh workspace data"
            >
              <RefreshCw
                className={`h-3.5 w-3.5 ${loadingData ? 'animate-spin' : ''}`}
              />
              <span className="hidden sm:inline">Refresh</span>
            </button>

            <div className="flex items-center gap-2 border-l border-slate-200 pl-3 text-right">
              <div className="hidden sm:block">
                <p className="text-xs font-semibold text-slate-900 leading-tight">
                  {bootstrap.currentUser.name}
                </p>
                <p className="font-mono text-[11px] text-slate-500 leading-tight">
                  {bootstrap.currentUser.role}
                </p>
              </div>
            </div>
          </div>
        </header>

        {/* Active Workspace Page */}
        <main className="mx-auto w-full max-w-6xl flex-1 px-6 py-7">
          {showMemberExperience ? (
            <>
              {memberTab === 'my-work' && (
                <MyWorkScreen
                  data={bootstrap}
                  activeProjectId={activeProjectId}
                  onSelectProjectContext={setActiveProjectId}
                  selectedDate={selectedWorkDate || bootstrap.todayInTz}
                  onSelectDate={setSelectedWorkDate}
                  onRefresh={loadBootstrap}
                  onToast={pushToast}
                  isPreviewMode={isAdminOrSuperAdmin && isPreviewMode}
                />
              )}
              {memberTab === 'my-projects' && (
                <ProjectsScreen
                  data={bootstrap}
                  activeProjectId={activeProjectId}
                  onSelectProjectContext={setActiveProjectId}
                  onRefresh={loadBootstrap}
                  onToast={pushToast}
                  isPreviewMode={isAdminOrSuperAdmin && isPreviewMode}
                />
              )}
              {memberTab === 'my-history' && (
                <MyHistoryScreen
                  data={bootstrap}
                  activeProjectId={activeProjectId}
                  onSelectProjectContext={setActiveProjectId}
                  selectedDate={selectedWorkDate || bootstrap.todayInTz}
                  onSelectDate={setSelectedWorkDate}
                  onRefresh={loadBootstrap}
                  onToast={pushToast}
                  isPreviewMode={isAdminOrSuperAdmin && isPreviewMode}
                />
              )}
              {memberTab === 'team-overview' && (
                <TeamOverviewScreen
                  data={bootstrap}
                  activeProjectId={activeProjectId}
                  onSelectProjectContext={setActiveProjectId}
                  selectedDate={selectedWorkDate || bootstrap.todayInTz}
                  onSelectDate={setSelectedWorkDate}
                  onRefresh={loadBootstrap}
                  onToast={pushToast}
                  isPreviewMode={isAdminOrSuperAdmin && isPreviewMode}
                />
              )}
              {memberTab === 'profile' && (
                <MemberProfileScreen
                  data={bootstrap}
                  activeProjectId={activeProjectId}
                  onSelectProjectContext={setActiveProjectId}
                  selectedDate={selectedWorkDate || bootstrap.todayInTz}
                  onSelectDate={setSelectedWorkDate}
                  onRefresh={loadBootstrap}
                  onToast={pushToast}
                  isPreviewMode={isAdminOrSuperAdmin && isPreviewMode}
                />
              )}
            </>
          ) : (
            <>
              {effectiveAdminTab === 'overview' && (
                <AdminOverviewScreen
                  data={bootstrap}
                  activeProjectId={activeProjectId}
                  onSelectProjectContext={setActiveProjectId}
                  onRefresh={loadBootstrap}
                  onToast={pushToast}
                  onNavigate={(tab) => setAdminTab(tab as AdminTab)}
                />
              )}
              {effectiveAdminTab === 'projects' && (
                <ProjectsScreen
                  data={bootstrap}
                  activeProjectId={activeProjectId}
                  onSelectProjectContext={setActiveProjectId}
                  onOpenProjectConfig={(pid) => {
                    setConfigProjectScope(pid);
                    setAdminTab('work-config');
                  }}
                  onRefresh={loadBootstrap}
                  onToast={pushToast}
                />
              )}
              {effectiveAdminTab === 'users' && (
                <AdminUsersScreen
                  data={bootstrap}
                  activeProjectId={activeProjectId}
                  onSelectProjectContext={setActiveProjectId}
                  onRefresh={loadBootstrap}
                  onToast={pushToast}
                />
              )}
              {effectiveAdminTab === 'team-work' && (
                <AdminTeamWorkScreen
                  data={bootstrap}
                  activeProjectId={activeProjectId}
                  onSelectProjectContext={setActiveProjectId}
                  onRefresh={loadBootstrap}
                  onToast={pushToast}
                />
              )}
              {effectiveAdminTab === 'sprint-overview' && (
                <AdminSprintOverviewScreen
                  data={bootstrap}
                  activeProjectId={activeProjectId}
                  onSelectProjectContext={setActiveProjectId}
                  onRefresh={loadBootstrap}
                  onToast={pushToast}
                />
              )}
              {effectiveAdminTab === 'reports' && (
                <AdminReportsScreen
                  data={bootstrap}
                  activeProjectId={activeProjectId}
                  onSelectProjectContext={setActiveProjectId}
                  onRefresh={loadBootstrap}
                  onToast={pushToast}
                />
              )}
              {effectiveAdminTab === 'work-config' && (
                <AdminWorkConfigScreen
                  data={bootstrap}
                  activeProjectId={activeProjectId}
                  preselectedConfigProjectId={configProjectScope}
                  onSelectProjectContext={setActiveProjectId}
                  onRefresh={loadBootstrap}
                  onToast={pushToast}
                />
              )}
              {effectiveAdminTab === 'audit-logs' && isSuperAdmin && (
                <AdminAuditLogsScreen
                  data={bootstrap}
                  activeProjectId={activeProjectId}
                  onSelectProjectContext={setActiveProjectId}
                  onRefresh={loadBootstrap}
                  onToast={pushToast}
                />
              )}
              {effectiveAdminTab === 'settings' && isSuperAdmin && (
                <AdminSettingsScreen
                  data={bootstrap}
                  activeProjectId={activeProjectId}
                  onSelectProjectContext={setActiveProjectId}
                  onRefresh={loadBootstrap}
                  onToast={pushToast}
                />
              )}
            </>
          )}
        </main>
      </div>

      <ToastViewport toasts={toasts} onDismiss={dismissToast} />
    </div>
  );
}
