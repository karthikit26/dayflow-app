import type {
  AuditLogEntry,
  DailySubmission,
  ProjectConfigurationVersion,
  ProjectSummary,
  SprintOverviewSummary,
  StoreData,
  TeamDailyOverviewRow,
  UserRecord,
  WorkFieldConfigVersion,
  WorkFieldDefinition,
  WorkFieldOption,
} from '../src/types';
import {
  getAccessibleProjectIds,
  getManageableProjectIds,
  getProjectPermissionContext,
} from './authz';

export class ServiceError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

export function appendAudit(
  draft: StoreData,
  params: Omit<AuditLogEntry, 'auditId' | 'timestamp'>
): void {
  draft.auditLogs.unshift({
    auditId: `AUD-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    timestamp: new Date().toISOString(),
    ...params,
  });
  if (draft.auditLogs.length > 5000) {
    draft.auditLogs.length = 5000;
  }
}

export function snapshotGlobalConfigVersion(
  draft: StoreData,
  actorEmail: string
): WorkFieldConfigVersion {
  const nextVersion = (draft.systemSettings.activeConfigVersion || 1) + 1;
  const versionRecord: WorkFieldConfigVersion = {
    version: nextVersion,
    fields: structuredClone(draft.workFieldDefinitions),
    options: structuredClone(draft.workFieldOptions),
    createdBy: actorEmail,
    createdAt: new Date().toISOString(),
  };
  draft.workFieldConfigurationVersions.push(versionRecord);
  draft.systemSettings.activeConfigVersion = nextVersion;
  return versionRecord;
}

export function getLatestProjectConfigRecord(
  store: StoreData,
  projectId: string
): ProjectConfigurationVersion | undefined {
  const versions = store.projectConfigurationVersions
    .filter((v) => v.projectId === projectId)
    .sort((a, b) => b.version - a.version);
  return versions[0];
}

export function getEffectiveProjectConfig(
  store: StoreData,
  projectId: string
): {
  version: number;
  fields: WorkFieldDefinition[];
  options: WorkFieldOption[];
  isProjectOverride: boolean;
} {
  const project = store.projects.find((p) => p.projectId === projectId);
  if (project && project.useProjectConfig) {
    const latest = getLatestProjectConfigRecord(store, projectId);
    if (latest) {
      return {
        version: latest.version,
        fields: latest.configurationData.fields
          .slice()
          .sort((a, b) => a.displayOrder - b.displayOrder),
        options: latest.configurationData.options
          .slice()
          .sort((a, b) => a.displayOrder - b.displayOrder),
        isProjectOverride: true,
      };
    }
  }
  return {
    version: store.systemSettings.activeConfigVersion || 1,
    fields: store.workFieldDefinitions
      .slice()
      .sort((a, b) => a.displayOrder - b.displayOrder),
    options: store.workFieldOptions
      .slice()
      .sort((a, b) => a.displayOrder - b.displayOrder),
    isProjectOverride: false,
  };
}

export function snapshotProjectConfigVersion(
  draft: StoreData,
  projectId: string,
  fields: WorkFieldDefinition[],
  options: WorkFieldOption[],
  actorEmail: string
): ProjectConfigurationVersion {
  const project = draft.projects.find((p) => p.projectId === projectId);
  if (!project) {
    throw new ServiceError(404, 'Project not found.');
  }
  const latest = getLatestProjectConfigRecord(draft, projectId);
  const nextVersion = latest ? latest.version + 1 : 1;
  const record: ProjectConfigurationVersion = {
    configId: `PCFG-${String(draft.projectConfigurationVersions.length + 1).padStart(4, '0')}`,
    projectId,
    version: nextVersion,
    configurationData: {
      fields: structuredClone(fields),
      options: structuredClone(options),
    },
    createdBy: actorEmail,
    createdAt: new Date().toISOString(),
  };
  draft.projectConfigurationVersions.push(record);
  project.activeConfigVersion = nextVersion;
  project.useProjectConfig = true;
  project.updatedAt = new Date().toISOString();
  return record;
}

export function getEntryConfigForValidation(
  store: StoreData,
  projectId: string,
  configVersion: number
): { fields: WorkFieldDefinition[]; options: WorkFieldOption[] } {
  const project = store.projects.find((p) => p.projectId === projectId);
  if (project?.useProjectConfig) {
    const pv = store.projectConfigurationVersions.find(
      (v) => v.projectId === projectId && v.version === configVersion
    );
    if (pv) return pv.configurationData;
    const latest = getLatestProjectConfigRecord(store, projectId);
    if (latest) return latest.configurationData;
  }
  const gv = store.workFieldConfigurationVersions.find(
    (v) => v.version === configVersion
  );
  if (gv) return { fields: gv.fields, options: gv.options };
  return {
    fields: store.workFieldDefinitions,
    options: store.workFieldOptions,
  };
}

export function assertDayNotLocked(
  draft: StoreData,
  userId: string,
  workDate: string
): DailySubmission | undefined {
  const submission = draft.dailySubmissions.find(
    (s) => s.userId === userId && s.workDate === workDate
  );
  if (submission && submission.status === 'Submitted') {
    throw new ServiceError(
      403,
      `Daily report for ${workDate} is already submitted and locked. Ask an Admin to reopen it if changes are required.`
    );
  }
  return submission;
}

export function computeAccessibleProjects(
  store: StoreData,
  viewer: UserRecord
): ProjectSummary[] {
  const userMap = new Map(store.users.map((u) => [u.userId, u.name]));
  const accessible = getAccessibleProjectIds(store, viewer);

  return store.projects
    .filter((p) => accessible.has(p.projectId))
    .map((p) => {
      const ctx = getProjectPermissionContext(store, viewer, p);
      const memberships = store.projectMemberships.filter(
        (m) => m.projectId === p.projectId && m.membershipStatus === 'Active'
      );
      const entries = store.workEntries.filter((w) => w.projectId === p.projectId);
      return {
        ...p,
        ownerName: userMap.get(p.ownerUserId) || p.createdBy,
        adminCount: memberships.filter((m) => m.projectRole === 'PROJECT_ADMIN').length,
        memberCount: memberships.filter((m) => m.projectRole === 'PROJECT_MEMBER').length,
        totalEntries: entries.length,
        completedEntries: entries.filter((e) => e.semanticStatus === 'completed').length,
        inProgressEntries: entries.filter((e) => e.semanticStatus === 'in_progress').length,
        blockedEntries: entries.filter((e) => e.semanticStatus === 'blocked').length,
        callerProjectRole: ctx.effectiveProjectRole,
        canManage: ctx.canManage,
      };
    });
}

export function computeTeamDailyOverview(
  store: StoreData,
  viewer: UserRecord,
  targetDate: string
): TeamDailyOverviewRow[] {
  const accessibleProjectIds = getAccessibleProjectIds(store, viewer);
  const viewerIsSuperAdmin = viewer.role === 'SUPER_ADMIN';

  // Only show active users who share at least one accessible project with viewer (or all active users for Super Admin)
  const relevantUserIds = new Set<string>();
  if (viewerIsSuperAdmin) {
    for (const u of store.users) {
      if (u.status === 'Active') relevantUserIds.add(u.userId);
    }
  } else {
    relevantUserIds.add(viewer.userId);
    for (const m of store.projectMemberships) {
      if (
        m.membershipStatus === 'Active' &&
        accessibleProjectIds.has(m.projectId)
      ) {
        relevantUserIds.add(m.userId);
      }
    }
  }

  return store.users
    .filter((u) => u.status === 'Active' && relevantUserIds.has(u.userId))
    .map((user) => {
      const entries = store.workEntries.filter(
        (w) =>
          w.userId === user.userId &&
          w.workDate === targetDate &&
          (viewerIsSuperAdmin || accessibleProjectIds.has(w.projectId))
      );
      const submission = store.dailySubmissions.find(
        (s) => s.userId === user.userId && s.workDate === targetDate
      );

      return {
        userId: user.userId,
        name: user.name,
        role: user.role,
        status: user.status,
        entriesTodayCount: entries.length,
        submissionStatusToday: submission ? submission.status : 'Pending',
        recentSummariesToday: entries.map((w) => ({
          workId: w.workId,
          projectId: w.projectId,
          summary: w.summary,
          category: w.category,
          status: w.status,
          semanticStatus: w.semanticStatus,
          sprintId: w.sprintId,
          adoReference: w.adoReference,
        })),
      };
    });
}

export function computeSprintOverviews(
  store: StoreData,
  accessibleProjectIds: Set<string>
): SprintOverviewSummary[] {
  const userNameMap = new Map(store.users.map((u) => [u.userId, u.name]));

  return store.sprints
    .filter((s) => accessibleProjectIds.has(s.projectId))
    .map((sprint) => {
      const entries = store.workEntries.filter(
        (w) => w.sprintId === sprint.sprintId && w.projectId === sprint.projectId
      );
      const completedCount = entries.filter(
        (e) => e.semanticStatus === 'completed'
      ).length;
      const inProgressCount = entries.filter(
        (e) => e.semanticStatus === 'in_progress'
      ).length;
      const blockedCount = entries.filter(
        (e) => e.semanticStatus === 'blocked'
      ).length;

      const catMap = new Map<string, number>();
      const memberMap = new Map<string, number>();
      const adoSet = new Set<string>();

      for (const e of entries) {
        catMap.set(e.category, (catMap.get(e.category) || 0) + 1);
        memberMap.set(e.userId, (memberMap.get(e.userId) || 0) + 1);
        if (e.adoReference) adoSet.add(e.adoReference);
      }

      return {
        ...sprint,
        totalEntries: entries.length,
        completedCount,
        inProgressCount,
        blockedCount,
        categoryBreakdown: Array.from(catMap.entries())
          .map(([category, count]) => ({ category, count }))
          .sort((a, b) => b.count - a.count),
        memberContributions: Array.from(memberMap.entries())
          .map(([userId, count]) => ({
            userId,
            name: userNameMap.get(userId) || userId,
            count,
          }))
          .sort((a, b) => b.count - a.count),
        adoReferences: Array.from(adoSet),
      };
    });
}

function normalizeSummarySentence(raw: string): string {
  const cleaned = raw.replace(/\s+/g, ' ').trim();
  if (!cleaned) return '';
  const withCap = cleaned.charAt(0).toUpperCase() + cleaned.slice(1);
  return /[.!?]$/.test(withCap) ? withCap : `${withCap}.`;
}

export function generateWeeklyTeamUpdate(
  store: StoreData,
  actor: UserRecord,
  weekStart: string,
  weekEnd: string,
  projectId?: string
): {
  empty: boolean;
  completedCount: number;
  inProgressCount: number;
  text: string;
  message?: string;
} {
  const manageableProjects = getManageableProjectIds(store, actor);
  if (projectId && !manageableProjects.has(projectId)) {
    throw new ServiceError(
      403,
      'You do not have administrative permission for the requested project.'
    );
  }

  const submittedKeys = new Set(
    store.dailySubmissions
      .filter(
        (s) =>
          s.status === 'Submitted' &&
          s.workDate >= weekStart &&
          s.workDate <= weekEnd
      )
      .map((s) => `${s.userId}::${s.workDate}`)
  );

  const eligible = store.workEntries.filter((w) => {
    if (w.workDate < weekStart || w.workDate > weekEnd) return false;
    if (!submittedKeys.has(`${w.userId}::${w.workDate}`)) return false;
    if (projectId) return w.projectId === projectId;
    return manageableProjects.has(w.projectId);
  });

  const completedItems: string[] = [];
  const inProgressItems: string[] = [];
  const seenCompleted = new Set<string>();
  const seenInProgress = new Set<string>();

  for (const entry of eligible) {
    const sentence = normalizeSummarySentence(entry.summary);
    if (!sentence) continue;
    const key = sentence.toLowerCase();

    if (entry.semanticStatus === 'completed') {
      if (!seenCompleted.has(key)) {
        seenCompleted.add(key);
        completedItems.push(sentence);
      }
    } else if (entry.semanticStatus === 'in_progress') {
      if (!seenInProgress.has(key) && !seenCompleted.has(key)) {
        seenInProgress.add(key);
        inProgressItems.push(sentence);
      }
    }
  }

  if (completedItems.length === 0 && inProgressItems.length === 0) {
    return {
      empty: true,
      completedCount: 0,
      inProgressCount: 0,
      text: '',
      message:
        'There is no completed or in-progress work from submitted daily reports available for the selected week.',
    };
  }

  const lines: string[] = ['Weekly Team Update', ''];

  lines.push('Work Completed', '');
  if (completedItems.length === 0) {
    lines.push('- No completed items recorded for this period.');
  } else {
    for (const item of completedItems) {
      lines.push(`- ${item}`);
    }
  }

  lines.push('', 'Work In Progress', '');
  if (inProgressItems.length === 0) {
    lines.push('- No ongoing items recorded for this period.');
  } else {
    for (const item of inProgressItems) {
      lines.push(`- ${item}`);
    }
  }

  return {
    empty: false,
    completedCount: completedItems.length,
    inProgressCount: inProgressItems.length,
    text: lines.join('\n'),
  };
}

export function sanitizeUserForViewer(
  user: UserRecord,
  viewer: UserRecord,
  sharedPeerEmails: boolean
): UserRecord {
  if (viewer.role === 'SUPER_ADMIN' || user.userId === viewer.userId) {
    return user;
  }
  return {
    ...user,
    email: sharedPeerEmails ? user.email : '',
  };
}
