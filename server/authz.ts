import type {
  Project,
  ProjectMembership,
  ProjectRole,
  StoreData,
  UserRecord,
  WorkEntry,
} from '../src/types';

export interface ProjectPermissionContext {
  hasAccess: boolean;
  canManage: boolean;
  isOwner: boolean;
  effectiveProjectRole: ProjectRole | null;
  membership: ProjectMembership | null;
}

export function getActiveProjectMembership(
  store: StoreData,
  userId: string,
  projectId: string
): ProjectMembership | null {
  return (
    store.projectMemberships.find(
      (m) =>
        m.projectId === projectId &&
        m.userId === userId &&
        m.membershipStatus === 'Active'
    ) || null
  );
}

export function getProjectPermissionContext(
  store: StoreData,
  user: UserRecord,
  project: Project
): ProjectPermissionContext {
  const membership = getActiveProjectMembership(
    store,
    user.userId,
    project.projectId
  );

  if (user.role === 'SUPER_ADMIN') {
    return {
      hasAccess: true,
      canManage: true,
      isOwner: true,
      effectiveProjectRole: 'PROJECT_ADMIN',
      membership,
    };
  }

  if (!membership) {
    return {
      hasAccess: false,
      canManage: false,
      isOwner: false,
      effectiveProjectRole: null,
      membership: null,
    };
  }

  // Global MEMBER can never hold PROJECT_ADMIN privileges (prevents escalation)
  if (user.role === 'MEMBER') {
    return {
      hasAccess: true,
      canManage: false,
      isOwner: false,
      effectiveProjectRole: 'PROJECT_MEMBER',
      membership,
    };
  }

  // Global ADMIN: PROJECT_ADMIN when assigned PROJECT_ADMIN; otherwise member-level access if assigned PROJECT_MEMBER
  const canManage = membership.projectRole === 'PROJECT_ADMIN';
  const isOwner = project.ownerUserId === user.userId;

  return {
    hasAccess: true,
    canManage,
    isOwner,
    effectiveProjectRole: membership.projectRole,
    membership,
  };
}

export function canCreateProject(user: UserRecord): boolean {
  return user.role === 'SUPER_ADMIN' || user.role === 'ADMIN';
}

export function canAccessProject(
  store: StoreData,
  user: UserRecord,
  projectId: string
): boolean {
  const project = store.projects.find((p) => p.projectId === projectId);
  if (!project) return false;
  return getProjectPermissionContext(store, user, project).hasAccess;
}

export function canManageProject(
  store: StoreData,
  user: UserRecord,
  projectId: string
): boolean {
  const project = store.projects.find((p) => p.projectId === projectId);
  if (!project) return false;
  return getProjectPermissionContext(store, user, project).canManage;
}

export function getAccessibleProjectIds(
  store: StoreData,
  user: UserRecord
): Set<string> {
  if (user.role === 'SUPER_ADMIN') {
    return new Set(store.projects.map((p) => p.projectId));
  }
  const allowed = new Set<string>();
  for (const project of store.projects) {
    if (getProjectPermissionContext(store, user, project).hasAccess) {
      allowed.add(project.projectId);
    }
  }
  return allowed;
}

export function getManageableProjectIds(
  store: StoreData,
  user: UserRecord
): Set<string> {
  if (user.role === 'SUPER_ADMIN') {
    return new Set(store.projects.map((p) => p.projectId));
  }
  if (user.role === 'MEMBER') {
    return new Set();
  }
  const allowed = new Set<string>();
  for (const project of store.projects) {
    if (getProjectPermissionContext(store, user, project).canManage) {
      allowed.add(project.projectId);
    }
  }
  return allowed;
}

export function canAccessWorkEntry(
  store: StoreData,
  actor: UserRecord,
  entry: WorkEntry
): boolean {
  if (actor.role === 'SUPER_ADMIN') return true;
  if (!canAccessProject(store, actor, entry.projectId)) return false;
  if (entry.userId === actor.userId) return true;
  return canManageProject(store, actor, entry.projectId);
}

export function canModifyWorkEntry(
  store: StoreData,
  actor: UserRecord,
  entry: WorkEntry
): boolean {
  if (actor.role === 'SUPER_ADMIN') return true;
  if (!canAccessProject(store, actor, entry.projectId)) return false;
  if (entry.userId === actor.userId) return true;
  return canManageProject(store, actor, entry.projectId);
}

export function assertNoRoleEscalation(
  actor: UserRecord,
  targetGlobalRole: UserRecord['role'],
  requestedProjectRole: ProjectRole
): string | null {
  // Members cannot hold PROJECT_ADMIN permissions
  if (targetGlobalRole === 'MEMBER' && requestedProjectRole === 'PROJECT_ADMIN') {
    return 'Cannot assign Project Admin role to a Member account. Promote their global role to Admin first via a Super Admin.';
  }
  // Only SUPER_ADMIN or ADMIN with project admin rights can assign PROJECT_ADMIN
  if (
    requestedProjectRole === 'PROJECT_ADMIN' &&
    actor.role !== 'SUPER_ADMIN' &&
    actor.role !== 'ADMIN'
  ) {
    return 'Unauthorized role assignment.';
  }
  return null;
}
