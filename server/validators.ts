import { z } from 'zod';
import {
  SPRINT_STATUSES,
  type FieldValue,
  type SemanticWorkStatus,
  type StoreData,
  type WorkFieldDefinition,
  type WorkFieldOption,
} from '../src/types';

export const dateRegex = /^\d{4}-\d{2}-\d{2}$/;

const PERSONAL_DOMAINS = new Set([
  'gmail.com',
  'googlemail.com',
  'yahoo.com',
  'hotmail.com',
  'outlook.com',
  'icloud.com',
  'aol.com',
  'protonmail.com',
  'proton.me',
]);

export function isPersonalEmailDomain(email: string): boolean {
  const domain = email.split('@')[1]?.toLowerCase() || '';
  return PERSONAL_DOMAINS.has(domain);
}

export function getDateTimePartsInTimezone(
  date: Date,
  timezone: string
): { dateStr: string; timeStr: string; weekday: number } {
  try {
    const formatter = new Intl.DateTimeFormat('en-CA', {
      timeZone: timezone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
      weekday: 'short',
    });
    const parts = formatter.formatToParts(date);
    const map: Record<string, string> = {};
    for (const p of parts) {
      map[p.type] = p.value;
    }
    const hour = map.hour === '24' ? '00' : map.hour;
    const weekdayMap: Record<string, number> = {
      Sun: 0,
      Mon: 1,
      Tue: 2,
      Wed: 3,
      Thu: 4,
      Fri: 5,
      Sat: 6,
    };
    return {
      dateStr: `${map.year}-${map.month}-${map.day}`,
      timeStr: `${hour}:${map.minute}`,
      weekday: weekdayMap[map.weekday] ?? date.getUTCDay(),
    };
  } catch {
    const iso = date.toISOString();
    return {
      dateStr: iso.slice(0, 10),
      timeStr: iso.slice(11, 16),
      weekday: date.getUTCDay(),
    };
  }
}

export function isValidUrl(val: string): boolean {
  try {
    const parsed = new URL(val);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
}

export function validateAdoReference(val: string): boolean {
  if (!val.trim()) return true;
  if (val.startsWith('http://') || val.startsWith('https://')) {
    return isValidUrl(val);
  }
  return /^[A-Za-z0-9#_.-]{2,64}$/.test(val.trim());
}

export function validateDynamicFieldValues(
  draft: StoreData,
  fields: WorkFieldDefinition[],
  options: WorkFieldOption[],
  rawValues: Record<string, unknown>,
  projectId?: string
): {
  cleaned: Record<string, FieldValue>;
  summary: string;
  category: string;
  status: string;
  semanticStatus: SemanticWorkStatus;
  sprintId?: string;
  adoReference?: string;
} {
  const cleaned: Record<string, FieldValue> = {};
  const activeFields = fields.filter((f) => f.active && !f.archived);

  let summary = '';
  let category = '';
  let status = '';
  let semanticStatus: SemanticWorkStatus = 'in_progress';
  let sprintId: string | undefined;
  let adoReference: string | undefined;

  for (const field of activeFields) {
    const raw = rawValues[field.fieldId];

    // Special handling for sprint dropdown populated from Sprints table (scoped to projectId!)
    if (field.systemRole === 'sprint') {
      const strVal = typeof raw === 'string' ? raw.trim() : '';
      if (field.required && !strVal) {
        throw new Error(`${field.label} is required.`);
      }
      if (strVal) {
        const sprint = draft.sprints.find((s) => s.sprintId === strVal);
        if (!sprint) {
          throw new Error(`Referenced sprint "${strVal}" does not exist.`);
        }
        if (projectId && sprint.projectId !== projectId) {
          throw new Error(
            `Sprint "${sprint.name}" does not belong to the selected project.`
          );
        }
        cleaned[field.fieldId] = strVal;
        sprintId = strVal;
      }
      continue;
    }

    if (field.fieldType === 'checkbox') {
      const boolVal = Boolean(raw);
      if (field.required && !boolVal) {
        throw new Error(`${field.label} must be checked.`);
      }
      cleaned[field.fieldId] = boolVal;
      continue;
    }

    if (field.fieldType === 'multi_select') {
      const arr = Array.isArray(raw)
        ? raw.filter((v): v is string => typeof v === 'string' && v.trim() !== '')
        : [];
      if (field.required && arr.length === 0) {
        throw new Error(`${field.label} requires at least one selection.`);
      }
      const allowed = new Set(
        options
          .filter((o) => o.fieldId === field.fieldId && o.active)
          .map((o) => o.value)
      );
      for (const item of arr) {
        if (!allowed.has(item)) {
          throw new Error(`Invalid option "${item}" for ${field.label}.`);
        }
      }
      if (arr.length > 0) cleaned[field.fieldId] = arr;
      continue;
    }

    if (field.fieldType === 'number') {
      const isEmpty = raw === undefined || raw === null || raw === '';
      if (isEmpty) {
        if (field.required) throw new Error(`${field.label} is required.`);
        continue;
      }
      const num = typeof raw === 'number' ? raw : Number(raw);
      if (Number.isNaN(num)) {
        throw new Error(`${field.label} must be a valid number.`);
      }
      if (field.validation?.min !== undefined && num < field.validation.min) {
        throw new Error(`${field.label} must be at least ${field.validation.min}.`);
      }
      if (field.validation?.max !== undefined && num > field.validation.max) {
        throw new Error(`${field.label} must be at most ${field.validation.max}.`);
      }
      cleaned[field.fieldId] = num;
      continue;
    }

    const strVal = typeof raw === 'string' ? raw.trim() : '';
    if (!strVal) {
      if (field.required) {
        throw new Error(`${field.label} is required.`);
      }
      continue;
    }

    if (field.fieldType === 'date' && !dateRegex.test(strVal)) {
      throw new Error(`${field.label} must be a valid YYYY-MM-DD date.`);
    }
    if (field.fieldType === 'url' && !isValidUrl(strVal)) {
      throw new Error(`${field.label} must be a valid http:// or https:// URL.`);
    }
    if (field.systemRole === 'ado_ref' && !validateAdoReference(strVal)) {
      throw new Error(
        `${field.label} must be a valid ticket ID (e.g. ADO-1234) or http(s) URL.`
      );
    }
    if (field.validation?.minLength && strVal.length < field.validation.minLength) {
      throw new Error(
        `${field.label} must be at least ${field.validation.minLength} characters.`
      );
    }
    if (field.validation?.maxLength && strVal.length > field.validation.maxLength) {
      throw new Error(
        `${field.label} must be at most ${field.validation.maxLength} characters.`
      );
    }
    if (field.validation?.pattern) {
      try {
        const re = new RegExp(field.validation.pattern);
        if (!re.test(strVal)) {
          throw new Error(`${field.label} does not match the required format.`);
        }
      } catch (e) {
        if (e instanceof Error && e.message.includes('required format')) throw e;
      }
    }

    if (field.fieldType === 'dropdown' || field.fieldType === 'radio') {
      const matchingOpt = options.find(
        (o) => o.fieldId === field.fieldId && o.active && o.value === strVal
      );
      if (!matchingOpt) {
        throw new Error(`Invalid option "${strVal}" selected for ${field.label}.`);
      }
      if (field.systemRole === 'status') {
        status = matchingOpt.label;
        semanticStatus = matchingOpt.semanticStatus || 'in_progress';
      } else if (field.systemRole === 'category') {
        category = matchingOpt.label;
      }
    }

    cleaned[field.fieldId] = strVal;

    if (field.systemRole === 'summary') summary = strVal;
    if (field.systemRole === 'ado_ref') adoReference = strVal;
  }

  if (!summary) {
    const firstText = Object.values(cleaned).find((v) => typeof v === 'string');
    summary = typeof firstText === 'string' ? firstText.slice(0, 180) : 'Work entry';
  }
  if (!category) category = 'General';
  if (!status) status = 'In Progress';

  return {
    cleaned,
    summary,
    category,
    status,
    semanticStatus,
    sprintId,
    adoReference,
  };
}

export const projectCreateSchema = z.object({
  name: z.string().trim().min(2, 'Project name must be at least 2 characters').max(120),
  description: z.string().trim().max(1000).optional().default(''),
  status: z.enum(['Active', 'Inactive', 'Archived']).default('Active'),
  useProjectConfig: z.boolean().default(false),
});

export const projectUpdateSchema = z.object({
  name: z.string().trim().min(2).max(120).optional(),
  description: z.string().trim().max(1000).optional(),
  status: z.enum(['Active', 'Inactive', 'Archived']).optional(),
  useProjectConfig: z.boolean().optional(),
});

export const projectInvitationCreateSchema = z.object({
  email: z.string().trim().email('Valid email address is required').transform((v) => v.toLowerCase()),
  projectRole: z.enum(['PROJECT_ADMIN', 'PROJECT_MEMBER']),
  expiresInDays: z.number().int().min(1).max(60).default(7),
});

export const projectMembershipPatchSchema = z.object({
  projectRole: z.enum(['PROJECT_ADMIN', 'PROJECT_MEMBER']).optional(),
  membershipStatus: z.enum(['Active', 'Inactive']).optional(),
});

export const workEntryPayloadSchema = z.object({
  projectId: z.string().trim().min(1, 'Project selection is required'),
  workDate: z.string().regex(dateRegex, 'Work date must be YYYY-MM-DD'),
  fieldValues: z.record(z.string(), z.unknown()),
  relatedWorkId: z.string().trim().optional(),
});

export const workEntryPatchSchema = z.object({
  fieldValues: z.record(z.string(), z.unknown()),
  relatedWorkId: z.string().trim().optional().nullable(),
});

export const completeDaySchema = z.object({
  workDate: z.string().regex(dateRegex),
  noWorkReason: z.string().trim().max(1000).optional().default(''),
});

export const reopenDaySchema = z.object({
  userId: z.string().trim().min(1),
  workDate: z.string().regex(dateRegex),
  reason: z.string().trim().min(5, 'Reopen reason must be at least 5 characters').max(500),
});

export const sprintCreateSchema = z.object({
  projectId: z.string().trim().min(1, 'Project selection is required'),
  name: z.string().trim().min(3).max(120),
  objective: z.string().trim().min(3).max(1000),
  startDate: z.string().regex(dateRegex),
  endDate: z.string().regex(dateRegex),
  status: z.enum(SPRINT_STATUSES as [string, ...string[]]).default('Planned'),
});

export const sprintUpdateSchema = sprintCreateSchema.omit({ projectId: true }).partial();

export const userCreateSchema = z.object({
  email: z.string().trim().email().transform((v) => v.toLowerCase()),
  name: z.string().trim().min(2).max(120),
  role: z.enum(['SUPER_ADMIN', 'ADMIN', 'MEMBER']).default('MEMBER'),
  status: z.enum(['Active', 'Inactive']).default('Active'),
  projectId: z.string().trim().optional(),
  projectRole: z.enum(['PROJECT_ADMIN', 'PROJECT_MEMBER']).optional(),
});

export const userUpdateSchema = z.object({
  name: z.string().trim().min(2).max(120).optional(),
  role: z.enum(['SUPER_ADMIN', 'ADMIN', 'MEMBER']).optional(),
  status: z.enum(['Active', 'Inactive']).optional(),
});

export const fieldCreateSchema = z.object({
  label: z.string().trim().min(2).max(100),
  fieldType: z.enum([
    'short_text',
    'long_text',
    'dropdown',
    'multi_select',
    'radio',
    'checkbox',
    'date',
    'url',
    'number',
  ]),
  required: z.boolean().default(false),
  placeholder: z.string().trim().max(200).optional().default(''),
  helpText: z.string().trim().max(300).optional().default(''),
  defaultValue: z.union([z.string(), z.array(z.string()), z.boolean(), z.number()]).optional(),
  validation: z
    .object({
      minLength: z.number().int().min(0).optional(),
      maxLength: z.number().int().min(1).optional(),
      min: z.number().optional(),
      max: z.number().optional(),
      pattern: z.string().optional(),
    })
    .optional(),
  options: z
    .array(
      z.object({
        label: z.string().trim().min(1).max(80),
        semanticStatus: z.enum(['completed', 'in_progress', 'blocked']).optional(),
      })
    )
    .optional(),
});

export const fieldUpdateSchema = z.object({
  label: z.string().trim().min(2).max(100).optional(),
  required: z.boolean().optional(),
  placeholder: z.string().trim().max(200).optional(),
  helpText: z.string().trim().max(300).optional(),
  displayOrder: z.number().int().min(1).optional(),
  active: z.boolean().optional(),
  archived: z.boolean().optional(),
  defaultValue: z.union([z.string(), z.array(z.string()), z.boolean(), z.number()]).optional().nullable(),
  validation: z
    .object({
      minLength: z.number().int().min(0).optional(),
      maxLength: z.number().int().min(1).optional(),
      min: z.number().optional(),
      max: z.number().optional(),
      pattern: z.string().optional(),
    })
    .optional(),
});

export const fieldOptionCreateSchema = z.object({
  fieldId: z.string().trim().min(1),
  label: z.string().trim().min(1).max(80),
  semanticStatus: z.enum(['completed', 'in_progress', 'blocked']).optional(),
});

export const fieldOptionUpdateSchema = z.object({
  label: z.string().trim().min(1).max(80).optional(),
  semanticStatus: z.enum(['completed', 'in_progress', 'blocked']).optional(),
  displayOrder: z.number().int().min(1).optional(),
  active: z.boolean().optional(),
});

export const settingsUpdateSchema = z.object({
  companyName: z.string().trim().min(2).max(120).optional(),
  timezone: z.string().trim().min(2).max(80).optional(),
  workingDays: z.array(z.number().int().min(0).max(6)).min(1).optional(),
  allowedDomains: z.array(z.string().trim().toLowerCase()).optional(),
  blockPersonalDomains: z.boolean().optional(),
  allowMemberEntryDeletion: z.boolean().optional(),
  minNoWorkReasonLength: z.number().int().min(3).max(200).optional(),
});
