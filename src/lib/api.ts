import type {
  AuditLogEntry,
  DailySubmission,
  ProjectConfigurationVersion,
  ProjectInvitation,
  ProjectMembership,
  ProjectSummary,
  SprintOverviewSummary,
  SystemSettings,
  TeamDailyOverviewRow,
  UserRecord,
  WorkEntry,
  WorkFieldConfigVersion,
  WorkFieldDefinition,
  WorkFieldOption,
} from '../types';
import { getFreshIdToken, getInMemoryAccessToken } from './firebase';

export interface EffectiveProjectConfig {
  version: number;
  fields: WorkFieldDefinition[];
  options: WorkFieldOption[];
  isProjectOverride: boolean;
}

export interface BootstrapPayload {
  currentUser: UserRecord;
  todayInTz: string;
  timeInTz: string;
  systemSettings: SystemSettings;
  users: UserRecord[];
  projects: ProjectSummary[];
  projectMemberships: ProjectMembership[];
  projectInvitations: ProjectInvitation[];
  projectConfigs: Record<string, EffectiveProjectConfig>;
  projectConfigurationVersions: ProjectConfigurationVersion[];
  sprints: SprintOverviewSummary[];
  teamDailyOverview: TeamDailyOverviewRow[];
  workEntries: WorkEntry[];
  dailySubmissions: DailySubmission[];
  workFieldDefinitions: WorkFieldDefinition[];
  workFieldOptions: WorkFieldOption[];
  workFieldConfigurationVersions: WorkFieldConfigVersion[];
  auditLogs: AuditLogEntry[];
}

export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

export async function apiRequest<T>(
  path: string,
  options: RequestInit = {}
): Promise<T> {
  const idToken = await getFreshIdToken();
  if (!idToken) {
    throw new ApiError(401, 'Not signed in');
  }

  const headers = new Headers(options.headers || {});
  headers.set('Authorization', `Bearer ${idToken}`);
  if (options.body && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }

  const accessToken = getInMemoryAccessToken();
  if (accessToken) {
    headers.set('X-Google-Access-Token', accessToken);
  }

  const res = await fetch(path, {
    ...options,
    headers,
  });

  const text = await res.text();
  let data: unknown = null;
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = { error: text };
    }
  }

  if (!res.ok) {
    const msg =
      (data &&
      typeof data === 'object' &&
      'error' in data &&
      typeof (data as { error?: unknown }).error === 'string'
        ? (data as { error: string }).error
        : null) || `Request failed (${res.status})`;
    throw new ApiError(res.status, msg);
  }

  return data as T;
}

export function fetchBootstrap(): Promise<BootstrapPayload> {
  return apiRequest<BootstrapPayload>('/api/bootstrap');
}

export function formatUtcInTimezone(utcIso: string, timezone: string): string {
  try {
    return new Intl.DateTimeFormat('en-IN', {
      timeZone: timezone,
      year: 'numeric',
      month: 'short',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hour12: true,
    }).format(new Date(utcIso));
  } catch {
    return new Date(utcIso).toLocaleString();
  }
}

export function getWeekBounds(dateStr: string): { weekStart: string; weekEnd: string } {
  const [y, m, d] = dateStr.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  const wd = dt.getUTCDay();
  const diffToMon = wd === 0 ? -6 : 1 - wd;
  const mon = new Date(Date.UTC(y, m - 1, d + diffToMon));
  const sun = new Date(Date.UTC(y, m - 1, d + diffToMon + 6));
  return {
    weekStart: mon.toISOString().slice(0, 10),
    weekEnd: sun.toISOString().slice(0, 10),
  };
}

export function isHttpUrl(val: string): boolean {
  return /^https?:\/\//i.test(val.trim());
}
