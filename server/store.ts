import fs from 'node:fs';
import path from 'node:path';
import type {
  Project,
  ProjectConfigurationVersion,
  ProjectMembership,
  StoreData,
  SystemSettings,
  WorkFieldConfigVersion,
  WorkFieldDefinition,
  WorkFieldOption,
} from '../src/types';

export interface IDataRepository {
  read(): Promise<StoreData>;
  mutate<T>(fn: (draft: StoreData) => Promise<T> | T): Promise<T>;
}

const DEFAULT_SETTINGS: SystemSettings = {
  companyName: 'DayFlow',
  timezone: 'Asia/Kolkata',
  workingDays: [1, 2, 3, 4, 5],
  allowedDomains: [],
  blockPersonalDomains: true,
  allowMemberEntryDeletion: true,
  minNoWorkReasonLength: 10,
  activeConfigVersion: 1,
};

export function createDefaultFields(nowIso: string): WorkFieldDefinition[] {
  return [
    {
      fieldId: 'fld_summary',
      label: 'Work Summary',
      fieldType: 'long_text',
      systemRole: 'summary',
      required: true,
      placeholder: 'Concise summary of the task or deliverable worked on...',
      helpText: 'Used in daily records and consolidated weekly team updates.',
      validation: { minLength: 4, maxLength: 600 },
      displayOrder: 1,
      active: true,
      archived: false,
      createdAt: nowIso,
      updatedAt: nowIso,
    },
    {
      fieldId: 'fld_category',
      label: 'Work Category',
      fieldType: 'dropdown',
      systemRole: 'category',
      required: true,
      placeholder: 'Select category',
      helpText: 'Primary classification for this work activity.',
      displayOrder: 2,
      active: true,
      archived: false,
      defaultValue: 'Development',
      createdAt: nowIso,
      updatedAt: nowIso,
    },
    {
      fieldId: 'fld_details',
      label: 'Description / Details',
      fieldType: 'long_text',
      systemRole: 'details',
      required: false,
      placeholder: 'Optional implementation notes, outcomes, or links...',
      helpText: 'Provide supporting details if helpful for sprint review.',
      validation: { maxLength: 2000 },
      displayOrder: 3,
      active: true,
      archived: false,
      createdAt: nowIso,
      updatedAt: nowIso,
    },
    {
      fieldId: 'fld_status',
      label: 'Work Status',
      fieldType: 'dropdown',
      systemRole: 'status',
      required: true,
      placeholder: 'Select status',
      helpText: 'Honest status used by sprint visibility and weekly summaries.',
      displayOrder: 4,
      active: true,
      archived: false,
      defaultValue: 'Completed',
      createdAt: nowIso,
      updatedAt: nowIso,
    },
    {
      fieldId: 'fld_sprint',
      label: 'Sprint',
      fieldType: 'dropdown',
      systemRole: 'sprint',
      required: false,
      placeholder: 'Associate with an active or planned sprint (optional)',
      helpText: 'Links this work entry to lightweight sprint tracking.',
      displayOrder: 5,
      active: true,
      archived: false,
      createdAt: nowIso,
      updatedAt: nowIso,
    },
    {
      fieldId: 'fld_ado_ref',
      label: 'ADO Ticket Reference',
      fieldType: 'short_text',
      systemRole: 'ado_ref',
      required: false,
      placeholder: 'e.g., ADO-1420 or https://dev.azure.com/...',
      helpText:
        'Manual Azure DevOps ticket ID or URL (Azure DevOps remains source of truth).',
      validation: { maxLength: 500 },
      displayOrder: 6,
      active: true,
      archived: false,
      createdAt: nowIso,
      updatedAt: nowIso,
    },
    {
      fieldId: 'fld_blocker',
      label: 'Blocker / Dependency',
      fieldType: 'long_text',
      systemRole: 'blocker',
      required: false,
      placeholder: 'Describe any dependency or blocker if status is Blocked...',
      helpText: 'Highlighted in Sprint Overview and Team Work when populated.',
      validation: { maxLength: 1000 },
      displayOrder: 7,
      active: true,
      archived: false,
      createdAt: nowIso,
      updatedAt: nowIso,
    },
    {
      fieldId: 'fld_notes',
      label: 'Additional Notes',
      fieldType: 'long_text',
      systemRole: 'notes',
      required: false,
      placeholder: 'Any handoff or context notes...',
      helpText: '',
      validation: { maxLength: 1000 },
      displayOrder: 8,
      active: true,
      archived: false,
      createdAt: nowIso,
      updatedAt: nowIso,
    },
  ];
}

export function createDefaultOptions(nowIso: string): WorkFieldOption[] {
  const categories = [
    'Development',
    'Bug Fix',
    'Code Review',
    'Testing',
    'Research',
    'Meeting',
    'Deployment',
    'Support',
    'Documentation',
    'Other',
  ];

  const categoryOptions: WorkFieldOption[] = categories.map((cat, idx) => ({
    optionId: `opt_cat_${idx + 1}`,
    fieldId: 'fld_category',
    label: cat,
    value: cat,
    displayOrder: idx + 1,
    active: true,
    createdAt: nowIso,
    updatedAt: nowIso,
  }));

  const statusOptions: WorkFieldOption[] = [
    {
      optionId: 'opt_st_1',
      fieldId: 'fld_status',
      label: 'Completed',
      value: 'Completed',
      semanticStatus: 'completed',
      displayOrder: 1,
      active: true,
      createdAt: nowIso,
      updatedAt: nowIso,
    },
    {
      optionId: 'opt_st_2',
      fieldId: 'fld_status',
      label: 'In Progress',
      value: 'In Progress',
      semanticStatus: 'in_progress',
      displayOrder: 2,
      active: true,
      createdAt: nowIso,
      updatedAt: nowIso,
    },
    {
      optionId: 'opt_st_3',
      fieldId: 'fld_status',
      label: 'Blocked',
      value: 'Blocked',
      semanticStatus: 'blocked',
      displayOrder: 3,
      active: true,
      createdAt: nowIso,
      updatedAt: nowIso,
    },
  ];

  return [...categoryOptions, ...statusOptions];
}

function createInitialStore(): StoreData {
  const nowIso = new Date().toISOString();
  const fields = createDefaultFields(nowIso);
  const options = createDefaultOptions(nowIso);
  const initialVersion: WorkFieldConfigVersion = {
    version: 1,
    fields: structuredClone(fields),
    options: structuredClone(options),
    createdBy: 'SYSTEM',
    createdAt: nowIso,
  };

  return {
    users: [],
    projects: [],
    projectMemberships: [],
    projectInvitations: [],
    projectConfigurationVersions: [],
    workEntries: [],
    dailySubmissions: [],
    sprints: [],
    workFieldDefinitions: fields,
    workFieldOptions: options,
    workFieldConfigurationVersions: [initialVersion],
    auditLogs: [],
    systemSettings: structuredClone(DEFAULT_SETTINGS),
  };
}

function migrateLegacyStore(store: StoreData): boolean {
  let changed = false;
  const nowIso = new Date().toISOString();

  if (store.systemSettings.companyName === 'WorkLedger') {
    store.systemSettings.companyName = 'DayFlow';
    changed = true;
  }

  // Promote earliest active ADMIN to SUPER_ADMIN if upgrading from v3 where only ADMIN existed
  const hasSuperAdmin = store.users.some((u) => u.role === 'SUPER_ADMIN');
  if (!hasSuperAdmin && store.users.length > 0) {
    const firstAdmin =
      store.users.find((u) => u.role === 'ADMIN' && u.status === 'Active') ||
      store.users[0];
    if (firstAdmin) {
      firstAdmin.role = 'SUPER_ADMIN';
      firstAdmin.updatedAt = nowIso;
      changed = true;
    }
  }

  // Ensure any pre-existing sprints or work entries from v3 have a valid projectId
  const needsDefaultProject =
    store.projects.length === 0 &&
    (store.workEntries.length > 0 || store.sprints.length > 0);

  if (needsDefaultProject) {
    const owner =
      store.users.find((u) => u.role === 'SUPER_ADMIN') ||
      store.users.find((u) => u.role === 'ADMIN') ||
      store.users[0];

    const defaultProject: Project = {
      projectId: 'PRJ-001',
      name: `${store.systemSettings.companyName || 'Core'} Workspace`,
      description: 'Default workspace project migrated from initial records.',
      ownerUserId: owner ? owner.userId : 'SYSTEM',
      createdBy: owner ? owner.email : 'SYSTEM',
      status: 'Active',
      useProjectConfig: false,
      activeConfigVersion: 1,
      createdAt: nowIso,
      updatedAt: nowIso,
    };
    store.projects.push(defaultProject);

    const cfg: ProjectConfigurationVersion = {
      configId: 'PCFG-0001',
      projectId: defaultProject.projectId,
      version: 1,
      configurationData: {
        fields: structuredClone(store.workFieldDefinitions),
        options: structuredClone(store.workFieldOptions),
      },
      createdBy: defaultProject.createdBy,
      createdAt: nowIso,
    };
    store.projectConfigurationVersions.push(cfg);

    for (const u of store.users) {
      const m: ProjectMembership = {
        membershipId: `PMB-${String(store.projectMemberships.length + 1).padStart(4, '0')}`,
        projectId: defaultProject.projectId,
        userId: u.userId,
        projectRole:
          u.role === 'SUPER_ADMIN' || u.role === 'ADMIN'
            ? 'PROJECT_ADMIN'
            : 'PROJECT_MEMBER',
        membershipStatus: u.status,
        invitedBy: defaultProject.createdBy,
        joinedAt: u.createdAt || nowIso,
        updatedAt: nowIso,
      };
      store.projectMemberships.push(m);
    }

    for (const s of store.sprints) {
      if (!s.projectId) {
        s.projectId = defaultProject.projectId;
      }
    }
    for (const w of store.workEntries) {
      if (!w.projectId) {
        w.projectId = defaultProject.projectId;
      }
    }
    changed = true;
  }

  return changed;
}

export class SerializedStoreRepository implements IDataRepository {
  private readonly filePath: string;
  private queue: Promise<unknown> = Promise.resolve();
  private cached: StoreData | null = null;

  constructor(filePath?: string) {
    this.filePath =
      filePath || path.resolve(process.cwd(), '.data', 'workledger-v3-store.json');
  }

  private async ensureLoaded(): Promise<StoreData> {
    if (this.cached) return this.cached;

    const dir = path.dirname(this.filePath);
    await fs.promises.mkdir(dir, { recursive: true });
    try {
      const raw = await fs.promises.readFile(this.filePath, 'utf8');
      const parsed = JSON.parse(raw) as Partial<StoreData>;
      const base = createInitialStore();
      this.cached = {
        users: Array.isArray(parsed.users) ? parsed.users : [],
        projects: Array.isArray(parsed.projects) ? parsed.projects : [],
        projectMemberships: Array.isArray(parsed.projectMemberships)
          ? parsed.projectMemberships
          : [],
        projectInvitations: Array.isArray(parsed.projectInvitations)
          ? parsed.projectInvitations
          : [],
        projectConfigurationVersions: Array.isArray(
          parsed.projectConfigurationVersions
        )
          ? parsed.projectConfigurationVersions
          : [],
        workEntries: Array.isArray(parsed.workEntries) ? parsed.workEntries : [],
        dailySubmissions: Array.isArray(parsed.dailySubmissions)
          ? parsed.dailySubmissions
          : [],
        sprints: Array.isArray(parsed.sprints) ? parsed.sprints : [],
        workFieldDefinitions:
          Array.isArray(parsed.workFieldDefinitions) &&
          parsed.workFieldDefinitions.length > 0
            ? parsed.workFieldDefinitions
            : base.workFieldDefinitions,
        workFieldOptions:
          Array.isArray(parsed.workFieldOptions) && parsed.workFieldOptions.length > 0
            ? parsed.workFieldOptions
            : base.workFieldOptions,
        workFieldConfigurationVersions:
          Array.isArray(parsed.workFieldConfigurationVersions) &&
          parsed.workFieldConfigurationVersions.length > 0
            ? parsed.workFieldConfigurationVersions
            : base.workFieldConfigurationVersions,
        auditLogs: Array.isArray(parsed.auditLogs) ? parsed.auditLogs : [],
        systemSettings: {
          ...base.systemSettings,
          ...(parsed.systemSettings || {}),
        },
      };
      if (migrateLegacyStore(this.cached)) {
        await this.persist(this.cached);
      }
    } catch (err: unknown) {
      const code = (err as NodeJS.ErrnoException)?.code;
      if (code === 'ENOENT') {
        this.cached = createInitialStore();
        await this.persist(this.cached);
      } else {
        throw err;
      }
    }
    return this.cached;
  }

  private async persist(data: StoreData): Promise<void> {
    const dir = path.dirname(this.filePath);
    await fs.promises.mkdir(dir, { recursive: true });
    const tmpPath = `${this.filePath}.tmp`;
    await fs.promises.writeFile(tmpPath, JSON.stringify(data, null, 2), 'utf8');
    await fs.promises.rename(tmpPath, this.filePath);
  }

  async read(): Promise<StoreData> {
    const run = this.queue.then(async () => {
      const data = await this.ensureLoaded();
      return structuredClone(data);
    });
    this.queue = run.catch(() => undefined);
    return run;
  }

  async mutate<T>(fn: (draft: StoreData) => Promise<T> | T): Promise<T> {
    const run = this.queue.then(async () => {
      const current = await this.ensureLoaded();
      const draft = structuredClone(current);
      const result = await fn(draft);
      this.cached = draft;
      await this.persist(draft);
      return result;
    });
    this.queue = run.catch(() => undefined);
    return run;
  }
}

export const repository: IDataRepository = new SerializedStoreRepository();
