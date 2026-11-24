import React, { useEffect, useMemo, useState } from 'react';
import type {
  FieldValue,
  ProjectSummary,
  SprintOverviewSummary,
  WorkEntry,
  WorkFieldDefinition,
  WorkFieldOption,
} from '../types';
import type { EffectiveProjectConfig } from '../lib/api';

interface DynamicWorkFormProps {
  projects: ProjectSummary[];
  initialProjectId: string;
  projectConfigs: Record<string, EffectiveProjectConfig>;
  fallbackFields: WorkFieldDefinition[];
  fallbackOptions: WorkFieldOption[];
  sprints: SprintOverviewSummary[];
  initialEntry?: WorkEntry | null;
  relatedEntries?: WorkEntry[];
  isPreviewMode?: boolean;
  busy?: boolean;
  error?: string | null;
  onSubmit: (
    projectId: string,
    fieldValues: Record<string, FieldValue>,
    relatedWorkId?: string
  ) => Promise<void>;
  onCancel: () => void;
}

export const DynamicWorkForm: React.FC<DynamicWorkFormProps> = ({
  projects,
  initialProjectId,
  projectConfigs,
  fallbackFields,
  fallbackOptions,
  sprints,
  initialEntry,
  relatedEntries = [],
  isPreviewMode = false,
  busy = false,
  error,
  onSubmit,
  onCancel,
}) => {
  const assignableProjects = useMemo(
    () => projects.filter((p) => p.status === 'Active'),
    [projects]
  );

  const [selectedProjectId, setSelectedProjectId] = useState<string>(
    initialEntry?.projectId ||
      (assignableProjects.some((p) => p.projectId === initialProjectId)
        ? initialProjectId
        : assignableProjects[0]?.projectId || '')
  );

  const effectiveConfig = useMemo(() => {
    const cfg = projectConfigs[selectedProjectId];
    if (cfg) return cfg;
    return {
      version: 1,
      fields: fallbackFields,
      options: fallbackOptions,
      isProjectOverride: false,
    };
  }, [projectConfigs, selectedProjectId, fallbackFields, fallbackOptions]);

  const activeFields = useMemo(
    () =>
      effectiveConfig.fields
        .filter((f) => f.active && !f.archived)
        .sort((a, b) => a.displayOrder - b.displayOrder),
    [effectiveConfig.fields]
  );

  const options = effectiveConfig.options;

  const projectSprints = useMemo(
    () =>
      sprints.filter(
        (s) => s.projectId === selectedProjectId && s.status !== 'Archived'
      ),
    [sprints, selectedProjectId]
  );

  const projectRelatedEntries = useMemo(
    () => relatedEntries.filter((w) => w.projectId === selectedProjectId),
    [relatedEntries, selectedProjectId]
  );

  const [values, setValues] = useState<Record<string, FieldValue>>({});
  const [relatedWorkId, setRelatedWorkId] = useState(
    initialEntry?.relatedWorkId || ''
  );
  const [localError, setLocalError] = useState<string | null>(null);

  useEffect(() => {
    setValues((prev) => {
      const next: Record<string, FieldValue> = {};
      for (const f of activeFields) {
        if (initialEntry && initialEntry.fieldValues[f.fieldId] !== undefined) {
          next[f.fieldId] = initialEntry.fieldValues[f.fieldId];
        } else if (prev[f.fieldId] !== undefined && !initialEntry) {
          // Preserve entered values on recoverable errors or compatible fields
          next[f.fieldId] = prev[f.fieldId];
        } else if (f.defaultValue !== undefined) {
          next[f.fieldId] = f.defaultValue;
        } else if (f.fieldType === 'checkbox') {
          next[f.fieldId] = false;
        } else if (f.fieldType === 'multi_select') {
          next[f.fieldId] = [];
        } else {
          next[f.fieldId] = '';
        }
      }
      return next;
    });
    if (initialEntry) {
      setRelatedWorkId(initialEntry.relatedWorkId || '');
    }
    setLocalError(null);
  }, [initialEntry, selectedProjectId, activeFields]);

  const setFieldVal = (fieldId: string, val: FieldValue) => {
    setValues((prev) => ({ ...prev, [fieldId]: val }));
  };

  const toggleMultiOption = (fieldId: string, optVal: string) => {
    setValues((prev) => {
      const current = Array.isArray(prev[fieldId])
        ? (prev[fieldId] as string[])
        : [];
      const next = current.includes(optVal)
        ? current.filter((v) => v !== optVal)
        : [...current, optVal];
      return { ...prev, [fieldId]: next };
    });
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLocalError(null);

    if (!selectedProjectId) {
      setLocalError('Select an assigned project before saving your work entry.');
      return;
    }

    for (const f of activeFields) {
      const val = values[f.fieldId];
      if (f.fieldType === 'checkbox') {
        if (f.required && val !== true) {
          setLocalError(`${f.label} is required.`);
          return;
        }
        continue;
      }
      if (f.fieldType === 'multi_select') {
        const arr = Array.isArray(val) ? val : [];
        if (f.required && arr.length === 0) {
          setLocalError(`${f.label} requires at least one selection.`);
          return;
        }
        continue;
      }
      if (f.fieldType === 'number') {
        const isEmpty = val === undefined || val === '' || val === null;
        if (f.required && isEmpty) {
          setLocalError(`${f.label} is required.`);
          return;
        }
        if (!isEmpty) {
          const num = Number(val);
          if (Number.isNaN(num)) {
            setLocalError(`${f.label} must be a valid number.`);
            return;
          }
          if (f.validation?.min !== undefined && num < f.validation.min) {
            setLocalError(`${f.label} must be at least ${f.validation.min}.`);
            return;
          }
          if (f.validation?.max !== undefined && num > f.validation.max) {
            setLocalError(`${f.label} must be at most ${f.validation.max}.`);
            return;
          }
        }
        continue;
      }

      const str = typeof val === 'string' ? val.trim() : '';
      if (f.required && !str) {
        setLocalError(`${f.label} is required.`);
        return;
      }
      if (str && f.validation?.minLength && str.length < f.validation.minLength) {
        setLocalError(
          `${f.label} must be at least ${f.validation.minLength} characters.`
        );
        return;
      }
      if (str && f.validation?.maxLength && str.length > f.validation.maxLength) {
        setLocalError(
          `${f.label} must be at most ${f.validation.maxLength} characters.`
        );
        return;
      }
    }

    await onSubmit(selectedProjectId, values, relatedWorkId || undefined);
  };

  const displayError = localError || error;

  if (assignableProjects.length === 0) {
    return (
      <div className="rounded-xl border border-amber-200 bg-amber-50 p-6 space-y-3">
        <h2 className="font-display text-base font-semibold text-amber-950">
          No Assigned Active Projects
        </h2>
        <p className="text-sm text-amber-900">
          Work entries must belong to an active project. Accept a pending project
          invitation in My Projects or contact your Admin/Super Admin to assign you to a
          project.
        </p>
        <div>
          <button
            type="button"
            onClick={onCancel}
            className="rounded-md border border-amber-300 bg-white px-4 py-2 text-xs font-medium text-amber-900 hover:bg-amber-100"
          >
            Close
          </button>
        </div>
      </div>
    );
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm space-y-5"
    >
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 pb-3.5">
        <div>
          <h2 className="font-display text-base font-semibold text-slate-900">
            {initialEntry
              ? `Edit Work Entry (${initialEntry.workId})`
              : 'Add Work Entry'}
          </h2>
          <p className="mt-0.5 text-xs text-slate-500">
            Form v{effectiveConfig.version}{' '}
            {effectiveConfig.isProjectOverride
              ? '· Project-specific configuration'
              : '· Global default configuration'}
          </p>
        </div>
        {isPreviewMode && (
          <span className="text-xs font-medium text-amber-800">
            Preview Form Simulation
          </span>
        )}
      </div>

      {displayError && (
        <div
          role="alert"
          className="rounded-md border border-red-200 bg-red-50 px-3.5 py-2.5 text-xs text-red-800"
        >
          {displayError}
        </div>
      )}

      {/* Mandatory Project Selection */}
      <div>
        <label
          htmlFor="work-project-select"
          className="block text-xs font-semibold text-slate-800"
        >
          Project *
        </label>
        <select
          id="work-project-select"
          required
          disabled={!!initialEntry}
          value={selectedProjectId}
          onChange={(e) => {
            setSelectedProjectId(e.target.value);
            setRelatedWorkId('');
          }}
          className="mt-1.5 w-full rounded-lg border border-slate-300 bg-slate-50/50 px-3 py-2 text-sm font-medium text-slate-900 focus:border-blue-600 focus:bg-white focus:outline-none disabled:opacity-60"
        >
          {assignableProjects.map((p) => (
            <option key={p.projectId} value={p.projectId}>
              {p.name}
            </option>
          ))}
        </select>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        {activeFields.map((field) => {
          const val = values[field.fieldId];
          const fieldOpts = options
            .filter((o) => o.fieldId === field.fieldId && o.active)
            .sort((a, b) => a.displayOrder - b.displayOrder);
          const isWide =
            field.fieldType === 'long_text' ||
            field.fieldType === 'multi_select';

          return (
            <div key={field.fieldId} className={isWide ? 'sm:col-span-2' : ''}>
              <label
                htmlFor={`dyn-${field.fieldId}`}
                className="block text-xs font-medium text-slate-700"
              >
                {field.label}
                {field.required && <span className="ml-1 text-red-600">*</span>}
              </label>

              {field.systemRole === 'sprint' ? (
                <select
                  id={`dyn-${field.fieldId}`}
                  required={field.required}
                  value={typeof val === 'string' ? val : ''}
                  onChange={(e) => setFieldVal(field.fieldId, e.target.value)}
                  className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm focus:border-blue-600 focus:outline-none"
                >
                  <option value="">
                    {field.placeholder || 'None (No Sprint)'}
                  </option>
                  {projectSprints.map((s) => (
                    <option key={s.sprintId} value={s.sprintId}>
                      {s.name} ({s.status})
                    </option>
                  ))}
                </select>
              ) : field.fieldType === 'short_text' ? (
                <input
                  id={`dyn-${field.fieldId}`}
                  type="text"
                  required={field.required}
                  placeholder={field.placeholder}
                  value={typeof val === 'string' ? val : ''}
                  onChange={(e) => setFieldVal(field.fieldId, e.target.value)}
                  className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-blue-600 focus:outline-none"
                />
              ) : field.fieldType === 'long_text' ? (
                <textarea
                  id={`dyn-${field.fieldId}`}
                  rows={3}
                  required={field.required}
                  placeholder={field.placeholder}
                  value={typeof val === 'string' ? val : ''}
                  onChange={(e) => setFieldVal(field.fieldId, e.target.value)}
                  className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-blue-600 focus:outline-none"
                />
              ) : field.fieldType === 'dropdown' ? (
                <select
                  id={`dyn-${field.fieldId}`}
                  required={field.required}
                  value={typeof val === 'string' ? val : ''}
                  onChange={(e) => setFieldVal(field.fieldId, e.target.value)}
                  className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm focus:border-blue-600 focus:outline-none"
                >
                  <option value="">
                    {field.placeholder || 'Select an option'}
                  </option>
                  {fieldOpts.map((opt) => (
                    <option key={opt.optionId} value={opt.value}>
                      {opt.label}
                    </option>
                  ))}
                </select>
              ) : field.fieldType === 'radio' ? (
                <div className="mt-2 flex flex-wrap gap-4">
                  {fieldOpts.map((opt) => (
                    <label
                      key={opt.optionId}
                      className="inline-flex items-center gap-2 text-sm text-slate-700"
                    >
                      <input
                        type="radio"
                        name={`radio-${field.fieldId}`}
                        value={opt.value}
                        checked={val === opt.value}
                        onChange={() => setFieldVal(field.fieldId, opt.value)}
                        className="accent-blue-700"
                      />
                      <span>{opt.label}</span>
                    </label>
                  ))}
                </div>
              ) : field.fieldType === 'multi_select' ? (
                <div className="mt-2 flex flex-wrap gap-2">
                  {fieldOpts.map((opt) => {
                    const selected =
                      Array.isArray(val) && val.includes(opt.value);
                    return (
                      <button
                        key={opt.optionId}
                        type="button"
                        onClick={() =>
                          toggleMultiOption(field.fieldId, opt.value)
                        }
                        className={`rounded-md border px-3 py-1.5 text-xs font-medium transition-colors ${
                          selected
                            ? 'border-blue-700 bg-blue-50 text-blue-800'
                            : 'border-slate-300 bg-white text-slate-600 hover:bg-slate-50'
                        }`}
                      >
                        {opt.label}
                      </button>
                    );
                  })}
                </div>
              ) : field.fieldType === 'checkbox' ? (
                <label className="mt-2 inline-flex items-center gap-2 text-sm text-slate-700">
                  <input
                    id={`dyn-${field.fieldId}`}
                    type="checkbox"
                    checked={Boolean(val)}
                    onChange={(e) =>
                      setFieldVal(field.fieldId, e.target.checked)
                    }
                    className="rounded border-slate-300 accent-blue-700"
                  />
                  <span>{field.placeholder || 'Yes'}</span>
                </label>
              ) : field.fieldType === 'date' ? (
                <input
                  id={`dyn-${field.fieldId}`}
                  type="date"
                  required={field.required}
                  value={typeof val === 'string' ? val : ''}
                  onChange={(e) => setFieldVal(field.fieldId, e.target.value)}
                  className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 font-mono text-sm"
                />
              ) : field.fieldType === 'url' ? (
                <input
                  id={`dyn-${field.fieldId}`}
                  type="url"
                  required={field.required}
                  placeholder={field.placeholder || 'https://...'}
                  value={typeof val === 'string' ? val : ''}
                  onChange={(e) => setFieldVal(field.fieldId, e.target.value)}
                  className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                />
              ) : (
                <input
                  id={`dyn-${field.fieldId}`}
                  type="number"
                  required={field.required}
                  placeholder={field.placeholder}
                  value={
                    typeof val === 'number' || typeof val === 'string'
                      ? val
                      : ''
                  }
                  onChange={(e) =>
                    setFieldVal(
                      field.fieldId,
                      e.target.value === '' ? '' : Number(e.target.value)
                    )
                  }
                  className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 font-mono text-sm"
                />
              )}

              {field.helpText && (
                <p className="mt-1 text-xs text-slate-500">{field.helpText}</p>
              )}
            </div>
          );
        })}

        {projectRelatedEntries.length > 0 && (
          <div className="sm:col-span-2">
            <label
              htmlFor="related-work-select"
              className="block text-xs font-medium text-slate-700"
            >
              Follow-Up Reference to Earlier Entry in Project (Optional)
            </label>
            <select
              id="related-work-select"
              value={relatedWorkId}
              onChange={(e) => setRelatedWorkId(e.target.value)}
              className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm"
            >
              <option value="">None</option>
              {projectRelatedEntries.slice(0, 25).map((r) => (
                <option key={r.workId} value={r.workId}>
                  {r.workId} ({r.workDate}) — {r.summary.slice(0, 80)}
                </option>
              ))}
            </select>
          </div>
        )}
      </div>

      <div className="flex items-center justify-end gap-3 border-t border-slate-100 pt-4">
        <button
          type="button"
          onClick={onCancel}
          className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
        >
          Cancel
        </button>
        <button
          type="submit"
          disabled={busy}
          className="rounded-lg bg-blue-700 px-5 py-2 text-sm font-semibold text-white transition-colors hover:bg-blue-800 disabled:opacity-60"
        >
          {busy
            ? 'Saving...'
            : isPreviewMode
            ? 'Test & Preview Save'
            : initialEntry
            ? 'Save Changes'
            : 'Save Work Entry'}
        </button>
      </div>
    </form>
  );
};
