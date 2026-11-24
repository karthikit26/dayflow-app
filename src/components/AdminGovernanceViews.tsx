import React, { useEffect, useMemo, useState } from 'react';
import {
  Archive,
  ArrowDown,
  ArrowUp,
  Download,
  ExternalLink,
  FileSpreadsheet,
  GitBranch,
  Layers,
  Plus,
  RefreshCw,
  RotateCcw,
  ShieldCheck,
  Sliders,
  X,
} from 'lucide-react';
import {
  FIELD_TYPE_LABELS,
  type FieldType,
  type SemanticWorkStatus,
  type WorkFieldDefinition,
  type WorkFieldOption,
} from '../types';
import {
  apiRequest,
  formatUtcInTimezone,
  getWeekBounds,
} from '../lib/api';
import {
  getInMemoryAccessToken,
  reauthorizeWorkspaceScopes,
} from '../lib/firebase';
import { ConfirmDialog } from './ConfirmDialog';
import { StatusText } from './StatusText';
import { WeeklySummaryPanel } from './WeeklySummaryPanel';
import type { AdminViewProps } from './AdminOpsViews';

const COMMON_TIMEZONES = [
  'Asia/Kolkata',
  'UTC',
  'America/New_York',
  'America/Los_Angeles',
  'Europe/London',
  'Europe/Berlin',
  'Asia/Singapore',
  'Australia/Sydney',
];

const WEEKDAY_LABELS: Array<{ day: number; label: string }> = [
  { day: 1, label: 'Mon' },
  { day: 2, label: 'Tue' },
  { day: 3, label: 'Wed' },
  { day: 4, label: 'Thu' },
  { day: 5, label: 'Fri' },
  { day: 6, label: 'Sat' },
  { day: 0, label: 'Sun' },
];

const ALL_FIELD_TYPES: FieldType[] = [
  'short_text',
  'long_text',
  'dropdown',
  'multi_select',
  'radio',
  'checkbox',
  'date',
  'url',
  'number',
];

const OPTION_FIELD_TYPES = new Set<FieldType>([
  'dropdown',
  'multi_select',
  'radio',
]);

const GLOBAL_SCOPE_ID = '__GLOBAL__';

// =============================================================================
// 5. WORK CONFIGURATION (Global Defaults [SUPER_ADMIN] + Project Overrides)
// =============================================================================
export const AdminWorkConfigScreen: React.FC<
  AdminViewProps & { preselectedConfigProjectId?: string }
> = ({ data, activeProjectId, preselectedConfigProjectId, onRefresh, onToast }) => {
  const isSuperAdmin = data.currentUser.role === 'SUPER_ADMIN';
  const manageableProjects = useMemo(
    () => data.projects.filter((p) => p.canManage),
    [data.projects]
  );

  const initialScope = useMemo(() => {
    if (
      preselectedConfigProjectId &&
      manageableProjects.some((p) => p.projectId === preselectedConfigProjectId)
    ) {
      return preselectedConfigProjectId;
    }
    if (
      activeProjectId &&
      manageableProjects.some((p) => p.projectId === activeProjectId)
    ) {
      return activeProjectId;
    }
    if (isSuperAdmin) return GLOBAL_SCOPE_ID;
    return manageableProjects[0]?.projectId || '';
  }, [preselectedConfigProjectId, activeProjectId, isSuperAdmin, manageableProjects]);

  const [scopeId, setScopeId] = useState<string>(initialScope);

  useEffect(() => {
    if (
      preselectedConfigProjectId &&
      manageableProjects.some((p) => p.projectId === preselectedConfigProjectId)
    ) {
      setScopeId(preselectedConfigProjectId);
    }
  }, [preselectedConfigProjectId, manageableProjects]);

  const isGlobalScope = isSuperAdmin && scopeId === GLOBAL_SCOPE_ID;
  const scopedProject = !isGlobalScope
    ? manageableProjects.find((p) => p.projectId === scopeId) || null
    : null;
  const isInheritingGlobal = Boolean(
    scopedProject && !scopedProject.useProjectConfig
  );
  const canEditCurrentScope =
    isGlobalScope || Boolean(scopedProject && scopedProject.useProjectConfig);

  const activeFields = useMemo(() => {
    if (isGlobalScope) {
      return data.workFieldDefinitions
        .slice()
        .sort((a, b) => a.displayOrder - b.displayOrder);
    }
    if (scopedProject) {
      const cfg = data.projectConfigs[scopedProject.projectId];
      if (cfg) {
        return cfg.fields
          .slice()
          .sort((a, b) => a.displayOrder - b.displayOrder);
      }
    }
    return data.workFieldDefinitions
      .slice()
      .sort((a, b) => a.displayOrder - b.displayOrder);
  }, [isGlobalScope, scopedProject, data.workFieldDefinitions, data.projectConfigs]);

  const activeOptions = useMemo(() => {
    if (isGlobalScope) {
      return data.workFieldOptions
        .slice()
        .sort((a, b) => a.displayOrder - b.displayOrder);
    }
    if (scopedProject) {
      const cfg = data.projectConfigs[scopedProject.projectId];
      if (cfg) {
        return cfg.options
          .slice()
          .sort((a, b) => a.displayOrder - b.displayOrder);
      }
    }
    return data.workFieldOptions
      .slice()
      .sort((a, b) => a.displayOrder - b.displayOrder);
  }, [isGlobalScope, scopedProject, data.workFieldOptions, data.projectConfigs]);

  const [selectedFieldId, setSelectedFieldId] = useState<string>(
    activeFields[0]?.fieldId || ''
  );

  // Create Field modal/drawer state
  const [showCreateField, setShowCreateField] = useState(false);
  const [newLabel, setNewLabel] = useState('');
  const [newType, setNewType] = useState<FieldType>('short_text');
  const [newRequired, setNewRequired] = useState(false);
  const [newPlaceholder, setNewPlaceholder] = useState('');
  const [newHelpText, setNewHelpText] = useState('');
  const [newMinLen, setNewMinLen] = useState('');
  const [newMaxLen, setNewMaxLen] = useState('');
  const [newMinNum, setNewMinNum] = useState('');
  const [newMaxNum, setNewMaxNum] = useState('');
  const [newOptionsText, setNewOptionsText] = useState('');

  // Edit Field modal state
  const [editingField, setEditingField] = useState<WorkFieldDefinition | null>(
    null
  );
  const [editLabel, setEditLabel] = useState('');
  const [editRequired, setEditRequired] = useState(false);
  const [editPlaceholder, setEditPlaceholder] = useState('');
  const [editHelpText, setEditHelpText] = useState('');
  const [editMinLen, setEditMinLen] = useState('');
  const [editMaxLen, setEditMaxLen] = useState('');

  // Option creation state
  const [newOptionLabel, setNewOptionLabel] = useState('');
  const [newOptionSemantic, setNewOptionSemantic] =
    useState<SemanticWorkStatus>('in_progress');

  // Revert confirmation dialog
  const [confirmRevertGlobal, setConfirmRevertGlobal] = useState(false);

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const selectedField =
    activeFields.find((f) => f.fieldId === selectedFieldId) || activeFields[0];

  const selectedFieldOptions = useMemo(() => {
    if (!selectedField) return [];
    return activeOptions
      .filter((o) => o.fieldId === selectedField.fieldId)
      .sort((a, b) => a.displayOrder - b.displayOrder);
  }, [activeOptions, selectedField]);

  const baseApiPrefix = isGlobalScope
    ? '/api/work-config'
    : scopedProject
    ? `/api/projects/${scopedProject.projectId}/config`
    : '';

  const versionHistory = useMemo(() => {
    if (isGlobalScope) {
      return data.workFieldConfigurationVersions
        .slice()
        .reverse()
        .map((v) => ({
          key: `g-${v.version}`,
          version: v.version,
          activeCount: v.fields.filter((f) => f.active && !f.archived).length,
          createdBy: v.createdBy,
          createdAt: v.createdAt,
        }));
    }
    if (!scopedProject) return [];
    return data.projectConfigurationVersions
      .filter((v) => v.projectId === scopedProject.projectId)
      .slice()
      .sort((a, b) => b.version - a.version)
      .map((v) => ({
        key: v.configId,
        version: v.version,
        activeCount: v.configurationData.fields.filter(
          (f) => f.active && !f.archived
        ).length,
        createdBy: v.createdBy,
        createdAt: v.createdAt,
      }));
  }, [
    isGlobalScope,
    scopedProject,
    data.workFieldConfigurationVersions,
    data.projectConfigurationVersions,
  ]);

  const handleToggleProjectOverrideMode = async (enableOverride: boolean) => {
    if (!scopedProject) return;
    setBusy(true);
    setError(null);
    try {
      await apiRequest(`/api/projects/${scopedProject.projectId}/config/mode`, {
        method: 'POST',
        body: JSON.stringify({ useProjectConfig: enableOverride }),
      });
      setConfirmRevertGlobal(false);
      onToast(
        'success',
        enableOverride
          ? `Project-specific form configuration enabled for "${scopedProject.name}".`
          : `"${scopedProject.name}" reverted to inherit Global Defaults.`
      );
      await onRefresh();
    } catch (err) {
      const msg =
        err instanceof Error ? err.message : 'Failed to switch configuration mode';
      setError(msg);
      onToast('error', msg);
    } finally {
      setBusy(false);
    }
  };

  const handleCreateField = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!baseApiPrefix) return;
    setBusy(true);
    setError(null);

    try {
      const validation: Record<string, number> = {};
      if (newMinLen !== '') validation.minLength = Number(newMinLen);
      if (newMaxLen !== '') validation.maxLength = Number(newMaxLen);
      if (newMinNum !== '') validation.min = Number(newMinNum);
      if (newMaxNum !== '') validation.max = Number(newMaxNum);

      const parsedOptions = OPTION_FIELD_TYPES.has(newType)
        ? newOptionsText
            .split('\n')
            .map((l) => l.trim())
            .filter(Boolean)
            .map((label) => ({ label }))
        : undefined;

      if (
        OPTION_FIELD_TYPES.has(newType) &&
        (!parsedOptions || parsedOptions.length === 0)
      ) {
        throw new Error(
          `Provide at least one option (one per line) for ${FIELD_TYPE_LABELS[newType]}.`
        );
      }

      const res = await apiRequest<{
        field: WorkFieldDefinition;
        configVersion?: number;
        version?: number;
      }>(`${baseApiPrefix}/fields`, {
        method: 'POST',
        body: JSON.stringify({
          label: newLabel.trim(),
          fieldType: newType,
          required: newRequired,
          placeholder: newPlaceholder.trim(),
          helpText: newHelpText.trim(),
          validation:
            Object.keys(validation).length > 0 ? validation : undefined,
          options: parsedOptions,
        }),
      });

      const ver = res.configVersion ?? res.version ?? 1;
      onToast(
        'success',
        `Created field "${res.field.label}" (saved configuration v${ver}).`
      );
      setSelectedFieldId(res.field.fieldId);
      setShowCreateField(false);
      setNewLabel('');
      setNewPlaceholder('');
      setNewHelpText('');
      setNewMinLen('');
      setNewMaxLen('');
      setNewMinNum('');
      setNewMaxNum('');
      setNewOptionsText('');
      await onRefresh();
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to create field';
      setError(msg);
      onToast('error', msg);
    } finally {
      setBusy(false);
    }
  };

  const openEditField = (field: WorkFieldDefinition) => {
    setEditingField(field);
    setEditLabel(field.label);
    setEditRequired(field.required);
    setEditPlaceholder(field.placeholder || '');
    setEditHelpText(field.helpText || '');
    setEditMinLen(
      field.validation?.minLength !== undefined
        ? String(field.validation.minLength)
        : ''
    );
    setEditMaxLen(
      field.validation?.maxLength !== undefined
        ? String(field.validation.maxLength)
        : ''
    );
    setError(null);
  };

  const handleSaveFieldEdit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingField || !baseApiPrefix) return;
    setBusy(true);
    setError(null);
    try {
      const validation = { ...(editingField.validation || {}) };
      if (editMinLen !== '') validation.minLength = Number(editMinLen);
      else delete validation.minLength;
      if (editMaxLen !== '') validation.maxLength = Number(editMaxLen);
      else delete validation.maxLength;

      const res = await apiRequest<{
        configVersion?: number;
        version?: number;
      }>(`${baseApiPrefix}/fields/${editingField.fieldId}`, {
        method: 'PATCH',
        body: JSON.stringify({
          label: editLabel.trim(),
          required: editRequired,
          placeholder: editPlaceholder.trim(),
          helpText: editHelpText.trim(),
          validation,
        }),
      });
      const ver = res.configVersion ?? res.version ?? 1;
      onToast('success', `Updated "${editLabel.trim()}" (v${ver}).`);
      setEditingField(null);
      await onRefresh();
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to update field';
      setError(msg);
      onToast('error', msg);
    } finally {
      setBusy(false);
    }
  };

  const handleToggleFieldState = async (
    field: WorkFieldDefinition,
    patch: Partial<{ active: boolean; archived: boolean }>
  ) => {
    if (!baseApiPrefix) return;
    setBusy(true);
    setError(null);
    try {
      const res = await apiRequest<{
        configVersion?: number;
        version?: number;
      }>(`${baseApiPrefix}/fields/${field.fieldId}`, {
        method: 'PATCH',
        body: JSON.stringify(patch),
      });
      const ver = res.configVersion ?? res.version ?? 1;
      onToast(
        'success',
        `Updated "${field.label}" (v${ver}). Historical records remain intact.`
      );
      await onRefresh();
    } catch (err) {
      const msg =
        err instanceof Error ? err.message : 'Failed to update field state';
      setError(msg);
      onToast('error', msg);
    } finally {
      setBusy(false);
    }
  };

  const handleMoveField = async (index: number, direction: -1 | 1) => {
    if (!baseApiPrefix) return;
    const targetIdx = index + direction;
    if (targetIdx < 0 || targetIdx >= activeFields.length) return;
    const reordered = activeFields.slice();
    const [item] = reordered.splice(index, 1);
    reordered.splice(targetIdx, 0, item);

    setBusy(true);
    setError(null);
    try {
      const res = await apiRequest<{
        configVersion?: number;
        version?: number;
      }>(`${baseApiPrefix}/fields/reorder`, {
        method: 'POST',
        body: JSON.stringify({
          orderedIds: reordered.map((f) => f.fieldId),
        }),
      });
      const ver = res.configVersion ?? res.version ?? 1;
      onToast('success', `Field display order saved (v${ver}).`);
      await onRefresh();
    } catch (err) {
      const msg =
        err instanceof Error ? err.message : 'Failed to reorder fields';
      setError(msg);
      onToast('error', msg);
    } finally {
      setBusy(false);
    }
  };

  const handleAddOption = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedField || !newOptionLabel.trim() || !baseApiPrefix) return;
    setBusy(true);
    setError(null);
    try {
      const res = await apiRequest<{
        configVersion?: number;
        version?: number;
      }>(`${baseApiPrefix}/options`, {
        method: 'POST',
        body: JSON.stringify({
          fieldId: selectedField.fieldId,
          label: newOptionLabel.trim(),
          semanticStatus:
            selectedField.systemRole === 'status'
              ? newOptionSemantic
              : undefined,
        }),
      });
      const ver = res.configVersion ?? res.version ?? 1;
      onToast(
        'success',
        `Added option "${newOptionLabel.trim()}" (v${ver}).`
      );
      setNewOptionLabel('');
      await onRefresh();
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to add option';
      setError(msg);
      onToast('error', msg);
    } finally {
      setBusy(false);
    }
  };

  const handleToggleOption = async (opt: WorkFieldOption) => {
    if (!baseApiPrefix) return;
    setBusy(true);
    setError(null);
    try {
      const res = await apiRequest<{
        configVersion?: number;
        version?: number;
      }>(`${baseApiPrefix}/options/${opt.optionId}`, {
        method: 'PATCH',
        body: JSON.stringify({ active: !opt.active }),
      });
      const ver = res.configVersion ?? res.version ?? 1;
      onToast(
        'success',
        `${opt.active ? 'Disabled' : 'Enabled'} option "${opt.label}" (v${ver}).`
      );
      await onRefresh();
    } catch (err) {
      const msg =
        err instanceof Error ? err.message : 'Failed to toggle option';
      setError(msg);
      onToast('error', msg);
    } finally {
      setBusy(false);
    }
  };

  if (!isSuperAdmin && manageableProjects.length === 0) {
    return (
      <div className="space-y-6">
        <div className="border-b border-slate-200 pb-5">
          <h1 className="font-display text-2xl font-bold tracking-tight text-slate-900">
            Project Work Configuration
          </h1>
          <p className="mt-1 text-sm text-slate-600">
            Customize dynamic work form fields per project you administer.
          </p>
        </div>
        <div className="rounded-xl border border-amber-200 bg-amber-50 p-6 text-sm text-amber-950">
          You do not currently administer any projects. Create a project or
          accept a Project Admin assignment under My Projects before customizing
          project work fields.
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4 border-b border-slate-200 pb-5">
        <div>
          <p className="text-xs text-slate-500">
            {isGlobalScope
              ? `Global Defaults · v${data.systemSettings.activeConfigVersion}`
              : scopedProject
              ? `${scopedProject.name} (${scopedProject.projectId}) · ${
                  scopedProject.useProjectConfig
                    ? `Isolated Override v${scopedProject.activeConfigVersion}`
                    : `Inheriting Global v${data.systemSettings.activeConfigVersion}`
                }`
              : 'Select Configuration Scope'}
          </p>
          <h1 className="mt-1 font-display text-2xl font-bold tracking-tight text-slate-900">
            Work Logging Configuration
          </h1>
          <p className="mt-1 text-sm text-slate-600">
            {isSuperAdmin
              ? 'Manage Global Default fields or configure isolated per-project overrides with independent version snapshots.'
              : 'Configure isolated work logging fields, validation rules, and dropdown options for projects you administer.'}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <select
            aria-label="Configuration target scope"
            value={scopeId}
            onChange={(e) => {
              setScopeId(e.target.value);
              setShowCreateField(false);
              setEditingField(null);
            }}
            className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-medium text-slate-900"
          >
            {isSuperAdmin && (
              <option value={GLOBAL_SCOPE_ID}>
                Global Defaults (All Inheriting Projects)
              </option>
            )}
            {manageableProjects.map((p) => (
              <option key={p.projectId} value={p.projectId}>
                Project: {p.name} (
                {p.useProjectConfig ? 'Custom Override' : 'Inherits Global'})
              </option>
            ))}
          </select>

          {canEditCurrentScope && (
            <button
              type="button"
              onClick={() => {
                setShowCreateField(!showCreateField);
                setError(null);
              }}
              className="inline-flex items-center gap-2 rounded-lg bg-blue-700 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-800 whitespace-nowrap shrink-0"
            >
              <Plus className="h-4 w-4" />
              <span>Add Custom Field</span>
            </button>
          )}
        </div>
      </div>

      {/* Project Config Mode Banner */}
      {scopedProject && (
        <div className="flex flex-wrap items-center justify-between gap-4 rounded-xl border border-slate-200 bg-white px-5 py-4 shadow-xs">
          <div className="flex items-start gap-3">
            <GitBranch className="mt-0.5 h-4 w-4 shrink-0 text-blue-700" />
            <div>
              <p className="text-sm font-semibold text-slate-900">
                {scopedProject.useProjectConfig
                  ? `Isolated Project Configuration Active (${scopedProject.name})`
                  : `Inheriting Global Defaults (${scopedProject.name})`}
              </p>
              <p className="mt-0.5 text-xs text-slate-600">
                {scopedProject.useProjectConfig
                  ? 'Changes made here apply strictly to this project and do not affect other projects or Global Defaults.'
                  : 'This project currently uses the organization-wide Global Defaults. Enable Project-Specific Configuration to customize fields independently.'}
              </p>
            </div>
          </div>

          {scopedProject.useProjectConfig ? (
            <button
              type="button"
              disabled={busy}
              onClick={() => setConfirmRevertGlobal(true)}
              className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3.5 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50 whitespace-nowrap shrink-0"
            >
              <RotateCcw className="h-3.5 w-3.5" />
              <span>Inherit Global Defaults</span>
            </button>
          ) : (
            <button
              type="button"
              disabled={busy}
              onClick={() => void handleToggleProjectOverrideMode(true)}
              className="inline-flex items-center gap-1.5 rounded-lg bg-slate-900 px-4 py-2 text-xs font-semibold text-white hover:bg-slate-800 whitespace-nowrap shrink-0"
            >
              <Sliders className="h-3.5 w-3.5" />
              <span>Enable Project-Specific Configuration</span>
            </button>
          )}
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

      {/* Create Field Drawer */}
      {showCreateField && canEditCurrentScope && (
        <form
          onSubmit={handleCreateField}
          className="rounded-xl border border-slate-300 bg-white p-6 shadow-sm space-y-4"
        >
          <div className="flex items-center justify-between">
            <h2 className="font-display text-base font-semibold text-slate-900">
              {isGlobalScope
                ? 'Create Global Work Field'
                : `Create Field for ${scopedProject?.name}`}
            </h2>
            <button
              type="button"
              onClick={() => setShowCreateField(false)}
              className="rounded p-1 text-slate-400 hover:bg-slate-100"
            >
              <X className="h-4 w-4" />
            </button>
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <div>
              <label className="block text-xs font-medium text-slate-700">
                Field Label *
              </label>
              <input
                type="text"
                required
                minLength={2}
                value={newLabel}
                onChange={(e) => setNewLabel(e.target.value)}
                placeholder="e.g., Release Environment"
                className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-700">
                Field Type *
              </label>
              <select
                value={newType}
                onChange={(e) => setNewType(e.target.value as FieldType)}
                className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm"
              >
                {ALL_FIELD_TYPES.map((ft) => (
                  <option key={ft} value={ft}>
                    {FIELD_TYPE_LABELS[ft]}
                  </option>
                ))}
              </select>
            </div>

            <div className="flex items-end pb-2">
              <label className="inline-flex items-center gap-2 text-sm text-slate-800">
                <input
                  type="checkbox"
                  checked={newRequired}
                  onChange={(e) => setNewRequired(e.target.checked)}
                  className="h-4 w-4 rounded border-slate-300 accent-blue-700"
                />
                <span>Required Field</span>
              </label>
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-700">
                Placeholder
              </label>
              <input
                type="text"
                value={newPlaceholder}
                onChange={(e) => setNewPlaceholder(e.target.value)}
                placeholder="Input hint text..."
                className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
              />
            </div>

            <div className="sm:col-span-2">
              <label className="block text-xs font-medium text-slate-700">
                Help Text
              </label>
              <input
                type="text"
                value={newHelpText}
                onChange={(e) => setNewHelpText(e.target.value)}
                placeholder="Optional guidance displayed beneath the field"
                className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
              />
            </div>

            {(newType === 'short_text' || newType === 'long_text') && (
              <>
                <div>
                  <label className="block text-xs font-medium text-slate-700">
                    Min Characters
                  </label>
                  <input
                    type="number"
                    min={0}
                    value={newMinLen}
                    onChange={(e) => setNewMinLen(e.target.value)}
                    className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 font-mono text-sm"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-700">
                    Max Characters
                  </label>
                  <input
                    type="number"
                    min={1}
                    value={newMaxLen}
                    onChange={(e) => setNewMaxLen(e.target.value)}
                    className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 font-mono text-sm"
                  />
                </div>
              </>
            )}

            {newType === 'number' && (
              <>
                <div>
                  <label className="block text-xs font-medium text-slate-700">
                    Minimum Value
                  </label>
                  <input
                    type="number"
                    value={newMinNum}
                    onChange={(e) => setNewMinNum(e.target.value)}
                    className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 font-mono text-sm"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-700">
                    Maximum Value
                  </label>
                  <input
                    type="number"
                    value={newMaxNum}
                    onChange={(e) => setNewMaxNum(e.target.value)}
                    className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 font-mono text-sm"
                  />
                </div>
              </>
            )}

            {OPTION_FIELD_TYPES.has(newType) && (
              <div className="sm:col-span-3">
                <label className="block text-xs font-medium text-slate-700">
                  Options (one per line) *
                </label>
                <textarea
                  rows={4}
                  required
                  value={newOptionsText}
                  onChange={(e) => setNewOptionsText(e.target.value)}
                  placeholder={'Staging\nUAT\nProduction'}
                  className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 font-mono text-xs"
                />
              </div>
            )}
          </div>

          <div className="flex justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={() => setShowCreateField(false)}
              className="rounded-lg border border-slate-300 px-4 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={busy}
              className="rounded-lg bg-blue-700 px-4 py-2 text-xs font-semibold text-white hover:bg-blue-800 disabled:opacity-60"
            >
              {busy ? 'Creating...' : 'Save Field & Snapshot Version'}
            </button>
          </div>
        </form>
      )}

      {/* Main Split: Field List + Field Inspector/Options */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <div className="lg:col-span-2 rounded-xl border border-slate-200 bg-white shadow-xs overflow-hidden">
          <div className="border-b border-slate-200 px-5 py-3 flex items-center justify-between bg-slate-50/50">
            <h2 className="font-display text-sm font-semibold text-slate-900">
              Form Fields ({activeFields.length})
            </h2>
            <span className="text-xs text-slate-500">
              {isInheritingGlobal
                ? 'Read-only Global Defaults preview'
                : 'Click any field to edit rules or options'}
            </span>
          </div>

          <div className="divide-y divide-slate-100">
            {activeFields.map((f, idx) => {
              const isSelected = selectedField?.fieldId === f.fieldId;
              return (
                <div
                  key={f.fieldId}
                  onClick={() => setSelectedFieldId(f.fieldId)}
                  className={`cursor-pointer p-4 flex flex-wrap items-center justify-between gap-4 transition-colors ${
                    isSelected ? 'bg-blue-50/50' : 'hover:bg-slate-50'
                  }`}
                >
                  <div className="space-y-0.5">
                    <div className="flex items-center gap-2">
                      <span className="font-mono text-xs text-slate-400 tabular-nums">
                        #{f.displayOrder}
                      </span>
                      <span className="font-medium text-sm text-slate-900">
                        {f.label}
                      </span>
                      {f.required && (
                        <span className="text-xs font-medium text-red-700">
                          Required
                        </span>
                      )}
                      {f.archived && <StatusText status="Archived" />}
                      {!f.archived && !f.active && (
                        <StatusText status="Inactive" />
                      )}
                    </div>
                    <div className="text-xs text-slate-500">
                      <span>{FIELD_TYPE_LABELS[f.fieldType]}</span>
                      <span className="mx-1.5" aria-hidden="true">
                        ·
                      </span>
                      <span className="font-mono">{f.systemRole}</span>
                      {f.helpText && (
                        <>
                          <span className="mx-1.5" aria-hidden="true">
                            ·
                          </span>
                          <span>{f.helpText}</span>
                        </>
                      )}
                    </div>
                  </div>

                  {canEditCurrentScope && (
                    <div
                      className="flex items-center gap-1"
                      onClick={(e) => e.stopPropagation()}
                    >
                      <button
                        type="button"
                        disabled={busy || idx === 0}
                        onClick={() => handleMoveField(idx, -1)}
                        className="rounded p-1.5 text-slate-500 hover:bg-slate-100 disabled:opacity-30"
                        title="Move up"
                      >
                        <ArrowUp className="h-3.5 w-3.5" />
                      </button>
                      <button
                        type="button"
                        disabled={busy || idx === activeFields.length - 1}
                        onClick={() => handleMoveField(idx, 1)}
                        className="rounded p-1.5 text-slate-500 hover:bg-slate-100 disabled:opacity-30"
                        title="Move down"
                      >
                        <ArrowDown className="h-3.5 w-3.5" />
                      </button>
                      <button
                        type="button"
                        onClick={() => openEditField(f)}
                        className="rounded px-2 py-1 text-xs font-medium text-blue-700 hover:bg-blue-50"
                      >
                        Edit
                      </button>
                      {!f.archived && (
                        <button
                          type="button"
                          disabled={busy}
                          onClick={() =>
                            handleToggleFieldState(f, { active: !f.active })
                          }
                          className="rounded px-2 py-1 text-xs font-medium text-slate-600 hover:bg-slate-100"
                        >
                          {f.active ? 'Disable' : 'Enable'}
                        </button>
                      )}
                      {f.systemRole === 'custom' && !f.archived && (
                        <button
                          type="button"
                          disabled={busy}
                          onClick={() =>
                            handleToggleFieldState(f, { archived: true })
                          }
                          className="rounded p-1.5 text-slate-500 hover:bg-red-50 hover:text-red-700"
                          title="Archive field"
                        >
                          <Archive className="h-3.5 w-3.5" />
                        </button>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>

        {/* Right Side: Options Editor & Version Log */}
        <div className="space-y-6">
          {selectedField && (
            <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-xs space-y-4">
              <div>
                <p className="text-xs font-mono text-slate-400">
                  {selectedField.fieldId}
                </p>
                <h2 className="font-display text-base font-semibold text-slate-900">
                  Options — {selectedField.label}
                </h2>
                <p className="mt-0.5 text-xs text-slate-500">
                  {selectedField.systemRole === 'sprint'
                    ? 'Populated dynamically from the project sprints.'
                    : OPTION_FIELD_TYPES.has(selectedField.fieldType)
                    ? 'Selectable values for this field. Status options map to semantic states for Sprint Overview & Weekly Summary.'
                    : `${FIELD_TYPE_LABELS[selectedField.fieldType]} inputs do not use static option lists.`}
                </p>
              </div>

              {selectedField.systemRole !== 'sprint' &&
                OPTION_FIELD_TYPES.has(selectedField.fieldType) && (
                  <>
                    <div className="divide-y divide-slate-100 border-t border-b border-slate-100">
                      {selectedFieldOptions.map((opt) => (
                        <div
                          key={opt.optionId}
                          className="flex items-center justify-between gap-2 py-2.5 text-xs"
                        >
                          <div>
                            <span
                              className={`font-medium ${
                                opt.active
                                  ? 'text-slate-900'
                                  : 'text-slate-400 line-through'
                              }`}
                            >
                              {opt.label}
                            </span>
                            {opt.semanticStatus && (
                              <span className="ml-2 font-mono text-[11px] text-slate-500">
                                ({opt.semanticStatus})
                              </span>
                            )}
                          </div>
                          {canEditCurrentScope && (
                            <button
                              type="button"
                              disabled={busy}
                              onClick={() => handleToggleOption(opt)}
                              className="font-medium text-blue-700 hover:underline"
                            >
                              {opt.active ? 'Disable' : 'Enable'}
                            </button>
                          )}
                        </div>
                      ))}
                    </div>

                    {canEditCurrentScope && (
                      <form onSubmit={handleAddOption} className="space-y-2.5">
                        <input
                          type="text"
                          required
                          value={newOptionLabel}
                          onChange={(e) => setNewOptionLabel(e.target.value)}
                          placeholder={`New ${selectedField.label} option...`}
                          className="w-full rounded-lg border border-slate-300 px-3 py-1.5 text-xs"
                        />
                        {selectedField.systemRole === 'status' && (
                          <select
                            aria-label="Semantic meaning"
                            value={newOptionSemantic}
                            onChange={(e) =>
                              setNewOptionSemantic(
                                e.target.value as SemanticWorkStatus
                              )
                            }
                            className="w-full rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-xs"
                          >
                            <option value="completed">
                              Semantic: completed (Weekly Update — Work Completed)
                            </option>
                            <option value="in_progress">
                              Semantic: in_progress (Weekly Update — Work In Progress)
                            </option>
                            <option value="blocked">
                              Semantic: blocked (Sprint Blocked Count)
                            </option>
                          </select>
                        )}
                        <button
                          type="submit"
                          disabled={busy}
                          className="w-full rounded-lg bg-slate-900 px-3 py-2 text-xs font-semibold text-white hover:bg-slate-800 disabled:opacity-60"
                        >
                          Add Option
                        </button>
                      </form>
                    )}
                  </>
                )}
            </section>
          )}

          {/* Isolated Version History */}
          <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-xs space-y-3">
            <div className="flex items-center gap-2">
              <Layers className="h-4 w-4 text-slate-500" />
              <h2 className="font-display text-sm font-semibold text-slate-900">
                {isGlobalScope
                  ? 'Global Configuration Versions'
                  : 'Project Configuration Versions'}
              </h2>
            </div>
            {versionHistory.length === 0 ? (
              <p className="text-xs text-slate-500">
                No project-specific version snapshots yet.
              </p>
            ) : (
              <div className="divide-y divide-slate-100 max-h-64 overflow-y-auto text-xs">
                {versionHistory.map((ver) => (
                  <div key={ver.key} className="py-2.5 space-y-0.5">
                    <div className="flex items-center justify-between font-medium text-slate-900">
                      <span className="font-mono">Version {ver.version}</span>
                      <span className="text-slate-500">
                        {ver.activeCount} active fields
                      </span>
                    </div>
                    <p className="text-slate-500">
                      By {ver.createdBy} ·{' '}
                      {formatUtcInTimezone(
                        ver.createdAt,
                        data.systemSettings.timezone
                      )}
                    </p>
                  </div>
                ))}
              </div>
            )}
          </section>
        </div>
      </div>

      {/* Edit Field Modal */}
      {editingField && canEditCurrentScope && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/45 px-4"
          role="dialog"
          aria-modal="true"
        >
          <form
            onSubmit={handleSaveFieldEdit}
            className="w-full max-w-md rounded-xl border border-slate-200 bg-white p-6 shadow-xl space-y-4"
          >
            <div className="flex items-center justify-between">
              <h3 className="font-display text-base font-semibold text-slate-900">
                Edit Field ({FIELD_TYPE_LABELS[editingField.fieldType]})
              </h3>
              <button
                type="button"
                onClick={() => setEditingField(null)}
                className="rounded p-1 text-slate-400 hover:bg-slate-100"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-700">
                Label *
              </label>
              <input
                type="text"
                required
                minLength={2}
                value={editLabel}
                onChange={(e) => setEditLabel(e.target.value)}
                className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
              />
            </div>

            <label className="inline-flex items-center gap-2 text-sm text-slate-800">
              <input
                type="checkbox"
                checked={editRequired}
                onChange={(e) => setEditRequired(e.target.checked)}
                className="h-4 w-4 rounded border-slate-300 accent-blue-700"
              />
              <span>Required</span>
            </label>

            <div>
              <label className="block text-xs font-medium text-slate-700">
                Placeholder
              </label>
              <input
                type="text"
                value={editPlaceholder}
                onChange={(e) => setEditPlaceholder(e.target.value)}
                className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-700">
                Help Text
              </label>
              <input
                type="text"
                value={editHelpText}
                onChange={(e) => setEditHelpText(e.target.value)}
                className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
              />
            </div>

            {(editingField.fieldType === 'short_text' ||
              editingField.fieldType === 'long_text') && (
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-slate-700">
                    Min Length
                  </label>
                  <input
                    type="number"
                    min={0}
                    value={editMinLen}
                    onChange={(e) => setEditMinLen(e.target.value)}
                    className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-1.5 font-mono text-sm"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-700">
                    Max Length
                  </label>
                  <input
                    type="number"
                    min={1}
                    value={editMaxLen}
                    onChange={(e) => setEditMaxLen(e.target.value)}
                    className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-1.5 font-mono text-sm"
                  />
                </div>
              </div>
            )}

            <div className="flex justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setEditingField(null)}
                className="rounded-lg border border-slate-300 px-3.5 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={busy}
                className="rounded-lg bg-blue-700 px-4 py-2 text-xs font-semibold text-white hover:bg-blue-800 disabled:opacity-60"
              >
                {busy ? 'Saving...' : 'Save Changes'}
              </button>
            </div>
          </form>
        </div>
      )}

      <ConfirmDialog
        open={confirmRevertGlobal}
        title="Inherit Global Default Configuration"
        description={`Switch "${scopedProject?.name}" back to inheriting Global Defaults? Existing historical work entries will continue displaying their saved snapshot versions.`}
        confirmLabel="Inherit Global Defaults"
        busy={busy}
        onConfirm={() => void handleToggleProjectOverrideMode(false)}
        onCancel={() => setConfirmRevertGlobal(false)}
      />
    </div>
  );
};

// =============================================================================
// 6. REPORTS (Project-Scoped Reporting + Weekly Summary + CSV Export)
// =============================================================================
type ReportMode =
  | 'daily'
  | 'weekly'
  | 'monthly'
  | 'project'
  | 'member'
  | 'sprint'
  | 'category'
  | 'submissions';

export const AdminReportsScreen: React.FC<AdminViewProps> = ({
  data,
  activeProjectId,
  onToast,
}) => {
  const [reportMode, setReportMode] = useState<ReportMode>('weekly');
  const [projectFilter, setProjectFilter] = useState(activeProjectId);
  const [selectedDate, setSelectedDate] = useState(data.todayInTz);
  const defaultWeek = getWeekBounds(data.todayInTz);
  const [weekStart, setWeekStart] = useState(defaultWeek.weekStart);
  const [weekEnd, setWeekEnd] = useState(defaultWeek.weekEnd);
  const [monthFilter, setMonthFilter] = useState(data.todayInTz.slice(0, 7));

  useEffect(() => {
    setProjectFilter(activeProjectId);
  }, [activeProjectId]);

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

  const projectFilteredEntries = useMemo(() => {
    return projectFilter
      ? data.workEntries.filter((w) => w.projectId === projectFilter)
      : data.workEntries;
  }, [data.workEntries, projectFilter]);

  const scopedEntries = useMemo(() => {
    return projectFilteredEntries.filter((w) => {
      if (reportMode === 'daily') return w.workDate === selectedDate;
      if (reportMode === 'weekly')
        return w.workDate >= weekStart && w.workDate <= weekEnd;
      if (reportMode === 'monthly') return w.workDate.startsWith(monthFilter);
      return true;
    });
  }, [
    projectFilteredEntries,
    reportMode,
    selectedDate,
    weekStart,
    weekEnd,
    monthFilter,
  ]);

  const memberSummary = useMemo(() => {
    return data.users.map((u) => {
      const entries = projectFilteredEntries.filter(
        (w) => w.userId === u.userId
      );
      const subs = data.dailySubmissions.filter(
        (s) => s.userId === u.userId && s.status === 'Submitted'
      );
      return {
        userId: u.userId,
        name: u.name,
        email: u.email,
        totalEntries: entries.length,
        completed: entries.filter((e) => e.semanticStatus === 'completed').length,
        inProgress: entries.filter((e) => e.semanticStatus === 'in_progress')
          .length,
        blocked: entries.filter((e) => e.semanticStatus === 'blocked').length,
        submittedDays: subs.length,
      };
    });
  }, [data.users, projectFilteredEntries, data.dailySubmissions]);

  const categorySummary = useMemo(() => {
    const map = new Map<
      string,
      { total: number; completed: number; inProgress: number; blocked: number }
    >();
    for (const w of projectFilteredEntries) {
      const row = map.get(w.category) || {
        total: 0,
        completed: 0,
        inProgress: 0,
        blocked: 0,
      };
      row.total += 1;
      if (w.semanticStatus === 'completed') row.completed += 1;
      else if (w.semanticStatus === 'in_progress') row.inProgress += 1;
      else if (w.semanticStatus === 'blocked') row.blocked += 1;
      map.set(w.category, row);
    }
    return Array.from(map.entries()).map(([category, counts]) => ({
      category,
      ...counts,
    }));
  }, [projectFilteredEntries]);

  const visibleSprints = useMemo(
    () =>
      projectFilter
        ? data.sprints.filter((s) => s.projectId === projectFilter)
        : data.sprints,
    [data.sprints, projectFilter]
  );

  const visibleProjects = useMemo(
    () =>
      projectFilter
        ? data.projects.filter((p) => p.projectId === projectFilter)
        : data.projects,
    [data.projects, projectFilter]
  );

  const exportCsv = () => {
    const headers = [
      'WorkId',
      'WorkDate',
      'Project',
      'Member',
      'Summary',
      'Category',
      'Status',
      'Sprint',
      'ADOReference',
      'CreatedAtUTC',
    ];
    const escapeCell = (v: unknown) =>
      `"${String(v ?? '').replace(/"/g, '""')}"`;

    const rows = scopedEntries.map((w) => [
      w.workId,
      w.workDate,
      projectMap.get(w.projectId)?.name || w.projectId,
      userMap.get(w.userId)?.name || w.userId,
      w.summary,
      w.category,
      w.status,
      w.sprintId ? sprintMap.get(w.sprintId) || w.sprintId : '',
      w.adoReference || '',
      w.createdAt,
    ]);

    const csv = [
      headers.map(escapeCell).join(','),
      ...rows.map((r) => r.map(escapeCell).join(',')),
    ].join('\n');

    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `dayflow-${reportMode}-report-${data.todayInTz}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    onToast('success', `Exported ${rows.length} records to CSV.`);
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4 border-b border-slate-200 pb-5">
        <div>
          <h1 className="font-display text-2xl font-bold tracking-tight text-slate-900">
            Reports & Exports
          </h1>
          <p className="mt-1 text-sm text-slate-600">
            Centralized activity reporting across daily, weekly, monthly,
            project-wise, member, sprint, category, and submission views.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <select
            aria-label="Filter report by project"
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
            onClick={exportCsv}
            className="inline-flex items-center gap-2 rounded-lg border border-slate-300 bg-white px-4 py-2 text-xs font-semibold text-slate-800 hover:bg-slate-50 whitespace-nowrap shrink-0"
          >
            <Download className="h-3.5 w-3.5" />
            <span>Export CSV</span>
          </button>
        </div>
      </div>

      {/* Prominent Weekly Team Update Panel */}
      <WeeklySummaryPanel
        todayInTz={data.todayInTz}
        projects={data.projects}
        selectedProjectId={projectFilter}
      />

      {/* Report Selector Tabs + Scoped Date Inputs */}
      <div className="flex flex-wrap items-center justify-between gap-4 rounded-xl border border-slate-200 bg-white p-4 shadow-xs">
        <div className="flex flex-wrap gap-1.5">
          {(
            [
              ['daily', 'Daily'],
              ['weekly', 'Weekly'],
              ['monthly', 'Monthly'],
              ['project', 'Project-wise'],
              ['member', 'Member-wise'],
              ['sprint', 'Sprint-wise'],
              ['category', 'Category-wise'],
              ['submissions', 'Submission Completion'],
            ] as Array<[ReportMode, string]>
          ).map(([id, label]) => (
            <button
              key={id}
              type="button"
              onClick={() => setReportMode(id)}
              className={`rounded-lg px-3 py-1.5 text-xs font-medium transition-colors whitespace-nowrap ${
                reportMode === id
                  ? 'bg-blue-700 text-white'
                  : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
              }`}
            >
              {label}
            </button>
          ))}
        </div>

        <div className="flex flex-wrap items-center gap-2 text-xs">
          {reportMode === 'daily' && (
            <input
              type="date"
              value={selectedDate}
              onChange={(e) => setSelectedDate(e.target.value)}
              className="rounded-lg border border-slate-300 px-2.5 py-1.5 font-mono"
            />
          )}
          {reportMode === 'weekly' && (
            <>
              <input
                type="date"
                value={weekStart}
                onChange={(e) => setWeekStart(e.target.value)}
                className="rounded-lg border border-slate-300 px-2.5 py-1.5 font-mono"
              />
              <span className="text-slate-400">to</span>
              <input
                type="date"
                value={weekEnd}
                onChange={(e) => setWeekEnd(e.target.value)}
                className="rounded-lg border border-slate-300 px-2.5 py-1.5 font-mono"
              />
            </>
          )}
          {reportMode === 'monthly' && (
            <input
              type="month"
              value={monthFilter}
              onChange={(e) => setMonthFilter(e.target.value)}
              className="rounded-lg border border-slate-300 px-2.5 py-1.5 font-mono"
            />
          )}
        </div>
      </div>

      {/* Report Tables */}
      {(reportMode === 'daily' ||
        reportMode === 'weekly' ||
        reportMode === 'monthly') && (
        <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-xs">
          <div className="border-b border-slate-200 px-5 py-3 text-xs font-medium text-slate-600">
            {scopedEntries.length} work{' '}
            {scopedEntries.length === 1 ? 'entry' : 'entries'} in selected range
          </div>
          {scopedEntries.length === 0 ? (
            <div className="p-8 text-center text-sm text-slate-500">
              No entries recorded in the selected date period.
            </div>
          ) : (
            <table className="w-full text-left text-sm">
              <thead className="border-b border-slate-200 bg-slate-50 text-xs text-slate-500">
                <tr>
                  <th className="px-4 py-2.5 font-medium">Date</th>
                  <th className="px-4 py-2.5 font-medium">Project</th>
                  <th className="px-4 py-2.5 font-medium">Member</th>
                  <th className="px-4 py-2.5 font-medium">Summary</th>
                  <th className="px-4 py-2.5 font-medium">Category</th>
                  <th className="px-4 py-2.5 font-medium">Sprint</th>
                  <th className="px-4 py-2.5 font-medium">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {scopedEntries.map((w) => (
                  <tr key={w.workId} className="hover:bg-slate-50">
                    <td className="px-4 py-3 font-mono text-xs text-slate-600 tabular-nums whitespace-nowrap">
                      {w.workDate}
                    </td>
                    <td className="px-4 py-3 text-xs font-medium text-slate-700 whitespace-nowrap">
                      {projectMap.get(w.projectId)?.name || w.projectId}
                    </td>
                    <td className="px-4 py-3 text-xs font-medium text-slate-900 whitespace-nowrap">
                      {userMap.get(w.userId)?.name || w.userId}
                    </td>
                    <td className="px-4 py-3 text-sm text-slate-900">
                      {w.summary}
                    </td>
                    <td className="px-4 py-3 text-xs text-slate-600 whitespace-nowrap">
                      {w.category}
                    </td>
                    <td className="px-4 py-3 text-xs text-slate-600 whitespace-nowrap">
                      {w.sprintId
                        ? sprintMap.get(w.sprintId) || w.sprintId
                        : '—'}
                    </td>
                    <td className="px-4 py-3">
                      <StatusText status={w.status} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}

      {reportMode === 'project' && (
        <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-xs">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-slate-200 bg-slate-50 text-xs text-slate-500">
              <tr>
                <th className="px-4 py-3 font-medium">Project</th>
                <th className="px-4 py-3 font-medium">Owner</th>
                <th className="px-4 py-3 font-medium">Status</th>
                <th className="px-4 py-3 font-medium">Members</th>
                <th className="px-4 py-3 font-medium">Entries</th>
                <th className="px-4 py-3 font-medium">Completed</th>
                <th className="px-4 py-3 font-medium">In Progress</th>
                <th className="px-4 py-3 font-medium">Blocked</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {visibleProjects.map((p) => (
                <tr key={p.projectId} className="hover:bg-slate-50">
                  <td className="px-4 py-3 font-medium text-slate-900">
                    {p.name}
                    <div className="font-mono text-[11px] font-normal text-slate-400">
                      {p.projectId}
                    </div>
                  </td>
                  <td className="px-4 py-3 text-xs text-slate-700">
                    {p.ownerName}
                  </td>
                  <td className="px-4 py-3">
                    <StatusText status={p.status} />
                  </td>
                  <td className="px-4 py-3 font-mono text-xs tabular-nums">
                    {p.adminCount + p.memberCount}
                  </td>
                  <td className="px-4 py-3 font-mono text-xs tabular-nums">
                    {p.totalEntries}
                  </td>
                  <td className="px-4 py-3 font-mono text-xs text-emerald-700 tabular-nums">
                    {p.completedEntries}
                  </td>
                  <td className="px-4 py-3 font-mono text-xs text-amber-700 tabular-nums">
                    {p.inProgressEntries}
                  </td>
                  <td className="px-4 py-3 font-mono text-xs text-red-700 tabular-nums">
                    {p.blockedEntries}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {reportMode === 'member' && (
        <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-xs">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-slate-200 bg-slate-50 text-xs text-slate-500">
              <tr>
                <th className="px-4 py-3 font-medium">Member</th>
                <th className="px-4 py-3 font-medium">Total Entries</th>
                <th className="px-4 py-3 font-medium">Completed</th>
                <th className="px-4 py-3 font-medium">In Progress</th>
                <th className="px-4 py-3 font-medium">Blocked</th>
                <th className="px-4 py-3 font-medium">Submitted Days</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {memberSummary.map((row) => (
                <tr key={row.userId} className="hover:bg-slate-50">
                  <td className="px-4 py-3 font-medium text-slate-900">
                    {row.name}
                    <div className="font-mono text-xs font-normal text-slate-400">
                      {row.email}
                    </div>
                  </td>
                  <td className="px-4 py-3 font-mono text-xs tabular-nums">
                    {row.totalEntries}
                  </td>
                  <td className="px-4 py-3 font-mono text-xs text-emerald-700 tabular-nums">
                    {row.completed}
                  </td>
                  <td className="px-4 py-3 font-mono text-xs text-amber-700 tabular-nums">
                    {row.inProgress}
                  </td>
                  <td className="px-4 py-3 font-mono text-xs text-red-700 tabular-nums">
                    {row.blocked}
                  </td>
                  <td className="px-4 py-3 font-mono text-xs text-slate-700 tabular-nums">
                    {row.submittedDays}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {reportMode === 'sprint' && (
        <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-xs">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-slate-200 bg-slate-50 text-xs text-slate-500">
              <tr>
                <th className="px-4 py-3 font-medium">Project</th>
                <th className="px-4 py-3 font-medium">Sprint</th>
                <th className="px-4 py-3 font-medium">Period</th>
                <th className="px-4 py-3 font-medium">Status</th>
                <th className="px-4 py-3 font-medium">Entries</th>
                <th className="px-4 py-3 font-medium">Completed</th>
                <th className="px-4 py-3 font-medium">In Progress</th>
                <th className="px-4 py-3 font-medium">Blocked</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {visibleSprints.map((s) => (
                <tr key={s.sprintId} className="hover:bg-slate-50">
                  <td className="px-4 py-3 text-xs font-medium text-slate-700">
                    {projectMap.get(s.projectId)?.name || s.projectId}
                  </td>
                  <td className="px-4 py-3 font-medium text-slate-900">
                    {s.name}
                  </td>
                  <td className="px-4 py-3 font-mono text-xs text-slate-600 tabular-nums whitespace-nowrap">
                    {s.startDate} to {s.endDate}
                  </td>
                  <td className="px-4 py-3">
                    <StatusText status={s.status} />
                  </td>
                  <td className="px-4 py-3 font-mono text-xs tabular-nums">
                    {s.totalEntries}
                  </td>
                  <td className="px-4 py-3 font-mono text-xs text-emerald-700 tabular-nums">
                    {s.completedCount}
                  </td>
                  <td className="px-4 py-3 font-mono text-xs text-amber-700 tabular-nums">
                    {s.inProgressCount}
                  </td>
                  <td className="px-4 py-3 font-mono text-xs text-red-700 tabular-nums">
                    {s.blockedCount}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {reportMode === 'category' && (
        <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-xs">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-slate-200 bg-slate-50 text-xs text-slate-500">
              <tr>
                <th className="px-4 py-3 font-medium">Category</th>
                <th className="px-4 py-3 font-medium">Total Entries</th>
                <th className="px-4 py-3 font-medium">Completed</th>
                <th className="px-4 py-3 font-medium">In Progress</th>
                <th className="px-4 py-3 font-medium">Blocked</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {categorySummary.map((row) => (
                <tr key={row.category} className="hover:bg-slate-50">
                  <td className="px-4 py-3 font-medium text-slate-900">
                    {row.category}
                  </td>
                  <td className="px-4 py-3 font-mono text-xs tabular-nums">
                    {row.total}
                  </td>
                  <td className="px-4 py-3 font-mono text-xs text-emerald-700 tabular-nums">
                    {row.completed}
                  </td>
                  <td className="px-4 py-3 font-mono text-xs text-amber-700 tabular-nums">
                    {row.inProgress}
                  </td>
                  <td className="px-4 py-3 font-mono text-xs text-red-700 tabular-nums">
                    {row.blocked}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {reportMode === 'submissions' && (
        <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-xs">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-slate-200 bg-slate-50 text-xs text-slate-500">
              <tr>
                <th className="px-4 py-3 font-medium">Work Date</th>
                <th className="px-4 py-3 font-medium">Member</th>
                <th className="px-4 py-3 font-medium">Entries</th>
                <th className="px-4 py-3 font-medium">Status</th>
                <th className="px-4 py-3 font-medium">Submitted At</th>
                <th className="px-4 py-3 font-medium">Notes</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {data.dailySubmissions.map((s) => (
                <tr key={s.submissionId} className="hover:bg-slate-50">
                  <td className="px-4 py-3 font-mono text-xs text-slate-600 tabular-nums">
                    {s.workDate}
                  </td>
                  <td className="px-4 py-3 text-xs font-medium text-slate-900">
                    {userMap.get(s.userId)?.name || s.userId}
                  </td>
                  <td className="px-4 py-3 font-mono text-xs tabular-nums">
                    {s.entryCount}
                  </td>
                  <td className="px-4 py-3">
                    <StatusText status={s.status} />
                  </td>
                  <td className="px-4 py-3 font-mono text-xs text-slate-500">
                    {formatUtcInTimezone(
                      s.submittedAt,
                      data.systemSettings.timezone
                    )}
                  </td>
                  <td className="px-4 py-3 text-xs text-slate-600">
                    {s.noWorkReason || s.reopenReason || '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
};

// =============================================================================
// 7. AUDIT LOGS (SUPER ADMIN ONLY)
// =============================================================================
export const AdminAuditLogsScreen: React.FC<AdminViewProps> = ({
  data,
  activeProjectId,
}) => {
  const [auditSearch, setAuditSearch] = useState('');
  const [entityFilter, setEntityFilter] = useState('');
  const [projectFilter, setProjectFilter] = useState(activeProjectId);

  useEffect(() => {
    setProjectFilter(activeProjectId);
  }, [activeProjectId]);

  const projectMap = useMemo(
    () => new Map(data.projects.map((p) => [p.projectId, p.name])),
    [data.projects]
  );

  const distinctEntities = useMemo(
    () => Array.from(new Set(data.auditLogs.map((a) => a.entityType))).sort(),
    [data.auditLogs]
  );

  const filteredAuditLogs = useMemo(() => {
    const q = auditSearch.trim().toLowerCase();
    return data.auditLogs.filter((a) => {
      if (entityFilter && a.entityType !== entityFilter) return false;
      if (projectFilter && a.projectId !== projectFilter) return false;
      if (q) {
        const hit =
          a.action.toLowerCase().includes(q) ||
          a.actorEmail.toLowerCase().includes(q) ||
          a.entityType.toLowerCase().includes(q) ||
          a.entityId.toLowerCase().includes(q) ||
          (a.projectId || '').toLowerCase().includes(q);
        if (!hit) return false;
      }
      return true;
    });
  }, [data.auditLogs, auditSearch, entityFilter, projectFilter]);

  return (
    <div className="space-y-6">
      <div className="border-b border-slate-200 pb-5">
        <div className="flex items-center gap-2 text-xs text-slate-500">
          <ShieldCheck className="h-3.5 w-3.5 text-slate-500" />
          <span>Super Admin Governance Ledger · Immutable Append-Only</span>
        </div>
        <h1 className="mt-1 font-display text-2xl font-bold tracking-tight text-slate-900">
          Audit Logs
        </h1>
        <p className="mt-1 text-sm text-slate-600">
          Tracks sign-ins, role assignments, project creations, invitations,
          membership changes, work logging, submissions, configuration updates,
          and Sheets synchronizations.
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-3 rounded-xl border border-slate-200 bg-white p-4 shadow-xs">
        <input
          type="text"
          value={auditSearch}
          onChange={(e) => setAuditSearch(e.target.value)}
          placeholder="Search action, actor email, or entity ID..."
          className="flex-1 min-w-[220px] rounded-lg border border-slate-300 px-3 py-1.5 text-xs"
        />

        <select
          aria-label="Filter audit logs by entity type"
          value={entityFilter}
          onChange={(e) => setEntityFilter(e.target.value)}
          className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs"
        >
          <option value="">All Entity Types</option>
          {distinctEntities.map((t) => (
            <option key={t} value={t}>
              {t}
            </option>
          ))}
        </select>

        <select
          aria-label="Filter audit logs by project"
          value={projectFilter}
          onChange={(e) => setProjectFilter(e.target.value)}
          className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs"
        >
          <option value="">All Projects & Global</option>
          {data.projects.map((p) => (
            <option key={p.projectId} value={p.projectId}>
              {p.name}
            </option>
          ))}
        </select>
      </div>

      <section className="rounded-xl border border-slate-200 bg-white shadow-xs overflow-hidden">
        <div className="border-b border-slate-200 bg-slate-50/50 px-5 py-3 text-xs font-medium text-slate-600">
          Showing {filteredAuditLogs.length} audit events
        </div>
        {filteredAuditLogs.length === 0 ? (
          <div className="p-8 text-center text-sm text-slate-500">
            No audit records match your filter.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="border-b border-slate-200 bg-slate-50 text-slate-500">
                <tr>
                  <th className="px-4 py-2.5 font-medium">
                    Timestamp ({data.systemSettings.timezone})
                  </th>
                  <th className="px-4 py-2.5 font-medium">Actor</th>
                  <th className="px-4 py-2.5 font-medium">Action</th>
                  <th className="px-4 py-2.5 font-medium">Project</th>
                  <th className="px-4 py-2.5 font-medium">Entity</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {filteredAuditLogs.map((log) => (
                  <tr key={log.auditId} className="hover:bg-slate-50">
                    <td className="px-4 py-2.5 font-mono text-slate-600 tabular-nums whitespace-nowrap">
                      {formatUtcInTimezone(
                        log.timestamp,
                        data.systemSettings.timezone
                      )}
                    </td>
                    <td className="px-4 py-2.5 text-slate-800 whitespace-nowrap">
                      <span className="font-mono">{log.actorEmail}</span>
                      <span className="ml-1.5 text-slate-400">
                        ({log.actorRole})
                      </span>
                    </td>
                    <td className="px-4 py-2.5 font-mono font-medium text-slate-900">
                      {log.action}
                    </td>
                    <td className="px-4 py-2.5 text-slate-700 whitespace-nowrap">
                      {log.projectId
                        ? projectMap.get(log.projectId) || log.projectId
                        : 'Global'}
                    </td>
                    <td className="px-4 py-2.5 font-mono text-slate-600">
                      {log.entityType}:{log.entityId}
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
// 8. SETTINGS (SUPER ADMIN ONLY: Global Policy & 13-Worksheet Google Sheets)
// =============================================================================
export const AdminSettingsScreen: React.FC<AdminViewProps> = ({
  data,
  onRefresh,
  onToast,
}) => {
  const [subTab, setSubTab] = useState<'general' | 'sheets'>('general');

  const [companyName, setCompanyName] = useState(
    data.systemSettings.companyName
  );
  const [timezone, setTimezone] = useState(data.systemSettings.timezone);
  const [workingDays, setWorkingDays] = useState<number[]>(
    data.systemSettings.workingDays
  );
  const [allowedDomainsText, setAllowedDomainsText] = useState(
    data.systemSettings.allowedDomains.join(', ')
  );
  const [blockPersonalDomains, setBlockPersonalDomains] = useState(
    data.systemSettings.blockPersonalDomains
  );
  const [allowMemberEntryDeletion, setAllowMemberEntryDeletion] = useState(
    data.systemSettings.allowMemberEntryDeletion
  );
  const [minNoWorkReasonLength, setMinNoWorkReasonLength] = useState(
    String(data.systemSettings.minNoWorkReasonLength)
  );

  // Google Sheets State
  const [sheetTitle, setSheetTitle] = useState(
    `${data.systemSettings.companyName} — DayFlow Store`
  );
  const [linkSpreadsheetId, setLinkSpreadsheetId] = useState(
    data.systemSettings.linkedSpreadsheetId || ''
  );
  const [confirmAction, setConfirmAction] = useState<
    'create-sheet' | 'link-sheet' | 'sync-sheet' | null
  >(null);

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const toggleWorkingDay = (day: number) => {
    setWorkingDays((prev) =>
      prev.includes(day) ? prev.filter((d) => d !== day) : [...prev, day]
    );
  };

  const handleSaveSettings = async (e: React.FormEvent) => {
    e.preventDefault();
    if (workingDays.length === 0) {
      setError('Select at least one working day.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const allowedDomains = allowedDomainsText
        .split(',')
        .map((d) => d.trim().toLowerCase())
        .filter(Boolean);

      await apiRequest('/api/settings', {
        method: 'PATCH',
        body: JSON.stringify({
          companyName: companyName.trim(),
          timezone: timezone.trim(),
          workingDays,
          allowedDomains,
          blockPersonalDomains,
          allowMemberEntryDeletion,
          minNoWorkReasonLength: Number(minNoWorkReasonLength) || 10,
        }),
      });
      onToast('success', 'System settings saved and logged.');
      await onRefresh();
    } catch (err) {
      const msg =
        err instanceof Error ? err.message : 'Failed to update settings';
      setError(msg);
      onToast('error', msg);
    } finally {
      setBusy(false);
    }
  };

  const handleReauthGoogle = async () => {
    setError(null);
    try {
      await reauthorizeWorkspaceScopes();
      onToast('success', 'Google Sheets authorization token refreshed.');
    } catch (err) {
      const msg =
        err instanceof Error
          ? err.message
          : 'Failed to refresh Google authorization';
      setError(msg);
      onToast('error', msg);
    }
  };

  const executeConfirmedSheetAction = async () => {
    if (!confirmAction) return;
    setBusy(true);
    setError(null);
    try {
      if (!getInMemoryAccessToken()) {
        await reauthorizeWorkspaceScopes();
      }
      if (confirmAction === 'create-sheet') {
        const res = await apiRequest<{
          spreadsheetId: string;
          updatedCells: number;
        }>('/api/sheets/create', {
          method: 'POST',
          body: JSON.stringify({ title: sheetTitle.trim() }),
        });
        onToast(
          'success',
          `Created 13-worksheet Google Sheet (${res.spreadsheetId}) and synced ${res.updatedCells} cells.`
        );
      } else if (confirmAction === 'link-sheet') {
        await apiRequest('/api/sheets/link', {
          method: 'POST',
          body: JSON.stringify({ spreadsheetId: linkSpreadsheetId.trim() }),
        });
        onToast(
          'success',
          `Linked spreadsheet ${linkSpreadsheetId.trim()}. Use Sync All 13 Worksheets Now to populate.`
        );
      } else if (confirmAction === 'sync-sheet') {
        const res = await apiRequest<{ updatedCells: number }>(
          '/api/sheets/sync',
          { method: 'POST' }
        );
        onToast(
          'success',
          `Synchronized all 13 worksheets to Google Sheets (${res.updatedCells} cells updated).`
        );
      }
      setConfirmAction(null);
      await onRefresh();
    } catch (err) {
      const msg =
        err instanceof Error ? err.message : 'Google Sheets operation failed';
      setError(msg);
      onToast('error', msg);
      setConfirmAction(null);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="border-b border-slate-200 pb-5">
        <h1 className="font-display text-2xl font-bold tracking-tight text-slate-900">
          Global Settings
        </h1>
        <p className="mt-1 text-sm text-slate-600">
          Configure company defaults, approved email domains, daily submission
          rules, and Google Sheets 13-worksheet persistence.
        </p>
      </div>

      {/* Settings Sub-tabs */}
      <div className="flex flex-wrap gap-2 border-b border-slate-200 pb-3">
        <button
          type="button"
          onClick={() => setSubTab('general')}
          className={`inline-flex items-center gap-2 rounded-lg px-3.5 py-2 text-xs font-medium ${
            subTab === 'general'
              ? 'bg-slate-900 text-white'
              : 'bg-white border border-slate-200 text-slate-700 hover:bg-slate-50'
          }`}
        >
          <Sliders className="h-3.5 w-3.5" />
          <span>Workspace & Policy</span>
        </button>

        <button
          type="button"
          onClick={() => setSubTab('sheets')}
          className={`inline-flex items-center gap-2 rounded-lg px-3.5 py-2 text-xs font-medium ${
            subTab === 'sheets'
              ? 'bg-slate-900 text-white'
              : 'bg-white border border-slate-200 text-slate-700 hover:bg-slate-50'
          }`}
        >
          <FileSpreadsheet className="h-3.5 w-3.5" />
          <span>Google Sheets Datastore (13 Tabs)</span>
        </button>
      </div>

      {error && (
        <div
          role="alert"
          className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-xs text-red-800"
        >
          {error}
        </div>
      )}

      {/* SUBTAB 1: WORKSPACE & POLICY SETTINGS */}
      {subTab === 'general' && (
        <form
          onSubmit={handleSaveSettings}
          className="max-w-3xl rounded-xl border border-slate-200 bg-white p-6 shadow-xs space-y-5"
        >
          <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
            <div>
              <label className="block text-xs font-medium text-slate-700">
                Company / Workspace Name
              </label>
              <input
                type="text"
                required
                minLength={2}
                value={companyName}
                onChange={(e) => setCompanyName(e.target.value)}
                className="mt-1.5 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-700">
                Company Default Timezone (IANA)
              </label>
              <select
                value={timezone}
                onChange={(e) => setTimezone(e.target.value)}
                className="mt-1.5 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 font-mono text-sm"
              >
                {COMMON_TIMEZONES.map((tz) => (
                  <option key={tz} value={tz}>
                    {tz}
                  </option>
                ))}
                {!COMMON_TIMEZONES.includes(timezone) && (
                  <option value={timezone}>{timezone}</option>
                )}
              </select>
            </div>

            <div className="sm:col-span-2">
              <span className="block text-xs font-medium text-slate-700">
                Standard Working Days
              </span>
              <div className="mt-2 flex flex-wrap gap-2">
                {WEEKDAY_LABELS.map(({ day, label }) => {
                  const active = workingDays.includes(day);
                  return (
                    <button
                      key={day}
                      type="button"
                      onClick={() => toggleWorkingDay(day)}
                      className={`rounded-lg border px-3 py-1.5 text-xs font-medium ${
                        active
                          ? 'border-blue-700 bg-blue-50 text-blue-800'
                          : 'border-slate-300 bg-white text-slate-600'
                      }`}
                    >
                      {label}
                    </button>
                  );
                })}
              </div>
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-700">
                Approved Workspace Domains (comma-separated)
              </label>
              <input
                type="text"
                value={allowedDomainsText}
                onChange={(e) => setAllowedDomainsText(e.target.value)}
                placeholder="company.com, subsidiary.com"
                className="mt-1.5 w-full rounded-lg border border-slate-300 px-3 py-2 font-mono text-xs"
              />
              <p className="mt-1 text-xs text-slate-500">
                Leave empty to allow pre-invited users or company domains based
                on personal-domain policy.
              </p>
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-700">
                Minimum No-Work Reason Length (characters)
              </label>
              <input
                type="number"
                min={3}
                max={200}
                value={minNoWorkReasonLength}
                onChange={(e) => setMinNoWorkReasonLength(e.target.value)}
                className="mt-1.5 w-full rounded-lg border border-slate-300 px-3 py-2 font-mono text-sm"
              />
            </div>

            <div className="sm:col-span-2 space-y-3 border-t border-slate-100 pt-4">
              <label className="flex items-start gap-2.5 text-sm text-slate-800">
                <input
                  type="checkbox"
                  checked={blockPersonalDomains}
                  onChange={(e) => setBlockPersonalDomains(e.target.checked)}
                  className="mt-0.5 h-4 w-4 rounded border-slate-300 accent-blue-700"
                />
                <span>
                  <span className="font-medium">
                    Block uninvited personal email domains
                  </span>
                  <span className="block text-xs text-slate-500">
                    Rejects @gmail.com / @yahoo.com sign-ins unless explicitly
                    added as a user or holding a pending project invitation.
                  </span>
                </span>
              </label>

              <label className="flex items-start gap-2.5 text-sm text-slate-800">
                <input
                  type="checkbox"
                  checked={allowMemberEntryDeletion}
                  onChange={(e) =>
                    setAllowMemberEntryDeletion(e.target.checked)
                  }
                  className="mt-0.5 h-4 w-4 rounded border-slate-300 accent-blue-700"
                />
                <span>
                  <span className="font-medium">
                    Allow Members to delete their own unlocked work entries
                  </span>
                  <span className="block text-xs text-slate-500">
                    Only applies before Complete Day locks the date.
                  </span>
                </span>
              </label>
            </div>
          </div>

          <div className="flex justify-end border-t border-slate-100 pt-4">
            <button
              type="submit"
              disabled={busy}
              className="rounded-lg bg-blue-700 px-5 py-2 text-sm font-semibold text-white hover:bg-blue-800 disabled:opacity-60"
            >
              {busy ? 'Saving...' : 'Save Settings'}
            </button>
          </div>
        </form>
      )}

      {/* SUBTAB 2: GOOGLE SHEETS 13-WORKSHEET DATASTORE */}
      {subTab === 'sheets' && (
        <div className="max-w-3xl space-y-6">
          <section className="rounded-xl border border-slate-200 bg-white p-6 shadow-xs space-y-4">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div>
                <h2 className="font-display text-base font-semibold text-slate-900">
                  Google Sheets 13-Worksheet Sync
                </h2>
                <p className="mt-1 text-xs text-slate-600">
                  Synchronizes Users, Projects, ProjectMemberships,
                  ProjectInvitations, ProjectConfigurationVersions, WorkEntries,
                  DailySubmissions, Sprints, WorkFieldDefinitions,
                  WorkFieldOptions, WorkFieldConfigurationVersions, AuditLogs,
                  and SystemSettings.
                </p>
              </div>
              <button
                type="button"
                onClick={handleReauthGoogle}
                className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 whitespace-nowrap"
              >
                Refresh Google Sheet Token
              </button>
            </div>

            {data.systemSettings.linkedSpreadsheetId ? (
              <div className="rounded-lg border border-slate-200 bg-slate-50 p-4 space-y-3 text-xs">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <span className="text-slate-500">
                      Linked Spreadsheet ID:{' '}
                    </span>
                    <span className="font-mono font-medium text-slate-900">
                      {data.systemSettings.linkedSpreadsheetId}
                    </span>
                  </div>
                  {data.systemSettings.linkedSpreadsheetUrl && (
                    <a
                      href={data.systemSettings.linkedSpreadsheetUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex items-center gap-1 font-medium text-blue-700 hover:underline"
                    >
                      <span>Open Google Sheet</span>
                      <ExternalLink className="h-3.5 w-3.5" />
                    </a>
                  )}
                </div>
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <span className="text-slate-500">
                    Last Sync:{' '}
                    {data.systemSettings.lastSheetsSyncAt
                      ? formatUtcInTimezone(
                          data.systemSettings.lastSheetsSyncAt,
                          data.systemSettings.timezone
                        )
                      : 'Not synced yet'}
                  </span>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => setConfirmAction('sync-sheet')}
                    className="inline-flex items-center gap-1.5 rounded-lg bg-blue-700 px-3.5 py-2 text-xs font-semibold text-white hover:bg-blue-800 disabled:opacity-60"
                  >
                    <RefreshCw className="h-3.5 w-3.5" />
                    <span>Sync All 13 Worksheets Now</span>
                  </button>
                </div>
              </div>
            ) : (
              <p className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-xs text-amber-900">
                No Google Sheet is linked yet. Create a new formatted DayFlow
                spreadsheet or link an existing Spreadsheet ID below.
              </p>
            )}

            <div className="grid grid-cols-1 gap-6 border-t border-slate-100 pt-4 sm:grid-cols-2">
              <div className="space-y-2.5">
                <h3 className="text-xs font-semibold text-slate-800">
                  Create New DayFlow Spreadsheet
                </h3>
                <input
                  type="text"
                  value={sheetTitle}
                  onChange={(e) => setSheetTitle(e.target.value)}
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-xs"
                />
                <button
                  type="button"
                  disabled={busy || !sheetTitle.trim()}
                  onClick={() => setConfirmAction('create-sheet')}
                  className="rounded-lg bg-slate-900 px-4 py-2 text-xs font-semibold text-white hover:bg-slate-800 disabled:opacity-60"
                >
                  Create & Populate 13-Sheet Workbook
                </button>
              </div>

              <div className="space-y-2.5">
                <h3 className="text-xs font-semibold text-slate-800">
                  Link Existing Spreadsheet ID
                </h3>
                <input
                  type="text"
                  value={linkSpreadsheetId}
                  onChange={(e) => setLinkSpreadsheetId(e.target.value)}
                  placeholder="1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgvE2upms"
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 font-mono text-xs"
                />
                <button
                  type="button"
                  disabled={busy || !linkSpreadsheetId.trim()}
                  onClick={() => setConfirmAction('link-sheet')}
                  className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-xs font-semibold text-slate-800 hover:bg-slate-50 disabled:opacity-60"
                >
                  Link Spreadsheet
                </button>
              </div>
            </div>
          </section>
        </div>
      )}

      {/* Confirmation Modal for Google Sheets Mutations */}
      <ConfirmDialog
        open={!!confirmAction}
        title={
          confirmAction === 'create-sheet'
            ? 'Create DayFlow Google Sheet'
            : confirmAction === 'link-sheet'
            ? 'Link Google Spreadsheet'
            : 'Sync Store to Google Sheets'
        }
        description={
          confirmAction === 'create-sheet'
            ? `This will create "${sheetTitle}" in your Google Drive with all 13 DayFlow worksheets and write the current records.`
            : confirmAction === 'link-sheet'
            ? `This will link spreadsheet ID "${linkSpreadsheetId}" as the DayFlow sync target.`
            : 'This will overwrite and synchronize all 13 worksheets in the linked Google Spreadsheet with the current DayFlow state.'
        }
        confirmLabel={
          confirmAction === 'create-sheet'
            ? 'Create & Sync'
            : confirmAction === 'link-sheet'
            ? 'Link Sheet'
            : 'Confirm Sync'
        }
        busy={busy}
        onConfirm={executeConfirmedSheetAction}
        onCancel={() => setConfirmAction(null)}
      />
    </div>
  );
};
