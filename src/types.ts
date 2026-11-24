export type UserRole = 'SUPER_ADMIN' | 'ADMIN' | 'MEMBER';
export type ProjectRole = 'PROJECT_ADMIN' | 'PROJECT_MEMBER';
export type AccountStatus = 'Active' | 'Inactive';
export type ProjectStatus = 'Active' | 'Inactive' | 'Archived';
export type InvitationStatus = 'Pending' | 'Accepted' | 'Revoked' | 'Expired';
export type SprintStatus = 'Planned' | 'Active' | 'Completed' | 'Archived';

export type FieldType =
  | 'short_text'
  | 'long_text'
  | 'dropdown'
  | 'multi_select'
  | 'radio'
  | 'checkbox'
  | 'date'
  | 'url'
  | 'number';

export type SemanticWorkStatus = 'completed' | 'in_progress' | 'blocked';

export type SystemFieldRole =
  | 'summary'
  | 'category'
  | 'details'
  | 'status'
  | 'sprint'
  | 'ado_ref'
  | 'blocker'
  | 'notes'
  | 'custom';

export const FIELD_TYPE_LABELS: Record<FieldType, string> = {
  short_text: 'Short Text',
  long_text: 'Long Text',
  dropdown: 'Dropdown',
  multi_select: 'Multi-select',
  radio: 'Radio Button',
  checkbox: 'Checkbox',
  date: 'Date',
  url: 'URL',
  number: 'Number',
};

export const SPRINT_STATUSES: SprintStatus[] = [
  'Planned',
  'Active',
  'Completed',
  'Archived',
];

export interface UserRecord {
  userId: string;
  email: string;
  name: string;
  avatarUrl?: string;
  role: UserRole;
  status: AccountStatus;
  createdAt: string;
  updatedAt: string;
}

export interface Project {
  projectId: string;
  name: string;
  description: string;
  ownerUserId: string;
  createdBy: string;
  status: ProjectStatus;
  useProjectConfig: boolean;
  activeConfigVersion: number;
  createdAt: string;
  updatedAt: string;
}

export interface ProjectMembership {
  membershipId: string;
  projectId: string;
  userId: string;
  projectRole: ProjectRole;
  membershipStatus: AccountStatus;
  invitedBy: string;
  joinedAt: string;
  updatedAt: string;
}

export interface ProjectInvitation {
  invitationId: string;
  projectId: string;
  inviteeEmail: string;
  assignedProjectRole: ProjectRole;
  invitedBy: string;
  invitationStatus: InvitationStatus;
  expiresAt: string;
  createdAt: string;
  acceptedAt?: string;
  revokedBy?: string;
  revokedAt?: string;
}

export interface FieldValidationRule {
  minLength?: number;
  maxLength?: number;
  min?: number;
  max?: number;
  pattern?: string;
}

export interface WorkFieldDefinition {
  fieldId: string;
  label: string;
  fieldType: FieldType;
  systemRole: SystemFieldRole;
  required: boolean;
  placeholder: string;
  helpText: string;
  validation?: FieldValidationRule;
  displayOrder: number;
  active: boolean;
  archived: boolean;
  defaultValue?: string | string[] | boolean | number;
  createdAt: string;
  updatedAt: string;
}

export interface WorkFieldOption {
  optionId: string;
  fieldId: string;
  label: string;
  value: string;
  semanticStatus?: SemanticWorkStatus;
  displayOrder: number;
  active: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface WorkFieldConfigVersion {
  version: number;
  fields: WorkFieldDefinition[];
  options: WorkFieldOption[];
  createdBy: string;
  createdAt: string;
}

export interface ProjectConfigurationVersion {
  configId: string;
  projectId: string;
  version: number;
  configurationData: {
    fields: WorkFieldDefinition[];
    options: WorkFieldOption[];
  };
  createdBy: string;
  createdAt: string;
}

export interface Sprint {
  sprintId: string;
  projectId: string;
  name: string;
  objective: string;
  startDate: string; // YYYY-MM-DD
  endDate: string; // YYYY-MM-DD
  status: SprintStatus;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}

export type FieldValue = string | string[] | boolean | number;

export interface WorkEntry {
  workId: string;
  projectId: string;
  userId: string;
  workDate: string; // YYYY-MM-DD in company timezone
  configVersion: number;
  fieldValues: Record<string, FieldValue>;
  // Normalized derived projections for fast indexing & reporting
  summary: string;
  category: string;
  status: string;
  semanticStatus: SemanticWorkStatus;
  sprintId?: string;
  adoReference?: string;
  relatedWorkId?: string;
  createdBy: string;
  createdAt: string; // UTC ISO
  updatedAt: string; // UTC ISO
}

export interface SubmissionCorrection {
  correctedAt: string;
  actorId: string;
  actorEmail: string;
  action: 'Reopen' | 'Resubmit';
  reason: string;
}

export interface DailySubmission {
  submissionId: string;
  userId: string;
  workDate: string; // YYYY-MM-DD
  entryCount: number;
  status: 'Submitted' | 'Reopened';
  noWorkReason?: string;
  submittedBy: string;
  submittedAt: string; // UTC ISO
  reopenedBy?: string;
  reopenedAt?: string;
  reopenReason?: string;
  correctionHistory: SubmissionCorrection[];
}

export interface AuditLogEntry {
  auditId: string;
  actorId: string;
  actorEmail: string;
  actorRole: UserRole | 'SYSTEM';
  action: string;
  entityType:
    | 'Auth'
    | 'User'
    | 'Project'
    | 'ProjectMembership'
    | 'ProjectInvitation'
    | 'ProjectConfig'
    | 'WorkEntry'
    | 'DailySubmission'
    | 'Sprint'
    | 'WorkFieldConfig'
    | 'SystemSettings'
    | 'WeeklySummary'
    | 'SheetsSync';
  entityId: string;
  projectId?: string;
  previousValue?: unknown;
  newValue?: unknown;
  timestamp: string; // UTC ISO
}

export interface SystemSettings {
  companyName: string;
  timezone: string; // default Asia/Kolkata
  workingDays: number[]; // [1,2,3,4,5]
  allowedDomains: string[];
  blockPersonalDomains: boolean;
  allowMemberEntryDeletion: boolean;
  minNoWorkReasonLength: number;
  activeConfigVersion: number;
  linkedSpreadsheetId?: string;
  linkedSpreadsheetUrl?: string;
  lastSheetsSyncAt?: string;
}

export interface StoreData {
  users: UserRecord[];
  projects: Project[];
  projectMemberships: ProjectMembership[];
  projectInvitations: ProjectInvitation[];
  projectConfigurationVersions: ProjectConfigurationVersion[];
  workEntries: WorkEntry[];
  dailySubmissions: DailySubmission[];
  sprints: Sprint[];
  workFieldDefinitions: WorkFieldDefinition[];
  workFieldOptions: WorkFieldOption[];
  workFieldConfigurationVersions: WorkFieldConfigVersion[];
  auditLogs: AuditLogEntry[];
  systemSettings: SystemSettings;
}

export interface TeamDailyOverviewRow {
  userId: string;
  name: string;
  role: UserRole;
  status: AccountStatus;
  entriesTodayCount: number;
  submissionStatusToday: 'Submitted' | 'Reopened' | 'Pending';
  recentSummariesToday: Array<{
    workId: string;
    projectId: string;
    summary: string;
    category: string;
    status: string;
    semanticStatus: SemanticWorkStatus;
    sprintId?: string;
    adoReference?: string;
  }>;
}

export interface SprintOverviewSummary extends Sprint {
  totalEntries: number;
  completedCount: number;
  inProgressCount: number;
  blockedCount: number;
  categoryBreakdown: Array<{ category: string; count: number }>;
  memberContributions: Array<{ userId: string; name: string; count: number }>;
  adoReferences: string[];
}

export interface ProjectSummary extends Project {
  ownerName: string;
  adminCount: number;
  memberCount: number;
  totalEntries: number;
  completedEntries: number;
  inProgressEntries: number;
  blockedEntries: number;
  callerProjectRole: ProjectRole | null;
  canManage: boolean;
}
