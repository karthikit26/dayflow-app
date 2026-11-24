import type { StoreData } from '../src/types';

export const WORKSHEET_NAMES = [
  'Users',
  'Projects',
  'ProjectMemberships',
  'ProjectInvitations',
  'ProjectConfigurationVersions',
  'WorkEntries',
  'DailySubmissions',
  'Sprints',
  'WorkFieldDefinitions',
  'WorkFieldOptions',
  'WorkFieldConfigurationVersions',
  'AuditLogs',
  'SystemSettings',
] as const;

export async function createDayFlowSpreadsheet(
  accessToken: string,
  title: string
): Promise<{ spreadsheetId: string; spreadsheetUrl: string }> {
  const res = await fetch('https://sheets.googleapis.com/v4/spreadsheets', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      properties: { title },
      sheets: WORKSHEET_NAMES.map((sheetTitle) => ({
        properties: { title: sheetTitle },
      })),
    }),
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Google Sheets creation failed (${res.status}): ${errText}`);
  }

  const data = (await res.json()) as {
    spreadsheetId: string;
    spreadsheetUrl: string;
  };
  return {
    spreadsheetId: data.spreadsheetId,
    spreadsheetUrl: data.spreadsheetUrl,
  };
}

export async function getSpreadsheetMetadata(
  accessToken: string,
  spreadsheetId: string
): Promise<{ title: string; sheetTitles: string[]; spreadsheetUrl: string }> {
  const res = await fetch(
    `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(
      spreadsheetId
    )}?fields=properties.title,spreadsheetUrl,sheets.properties.title`,
    {
      headers: { Authorization: `Bearer ${accessToken}` },
    }
  );

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(
      `Failed to read spreadsheet metadata (${res.status}): ${errText}`
    );
  }

  const data = (await res.json()) as {
    properties?: { title?: string };
    spreadsheetUrl?: string;
    sheets?: Array<{ properties?: { title?: string } }>;
  };

  return {
    title: data.properties?.title || 'Spreadsheet',
    spreadsheetUrl:
      data.spreadsheetUrl ||
      `https://docs.google.com/spreadsheets/d/${spreadsheetId}/edit`,
    sheetTitles: (data.sheets || [])
      .map((s) => s.properties?.title || '')
      .filter(Boolean),
  };
}

async function ensureRequiredTabs(
  accessToken: string,
  spreadsheetId: string,
  existingTitles: string[]
): Promise<void> {
  const missing = WORKSHEET_NAMES.filter(
    (name) => !existingTitles.includes(name)
  );
  if (missing.length === 0) return;

  const res = await fetch(
    `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(
      spreadsheetId
    )}:batchUpdate`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        requests: missing.map((title) => ({
          addSheet: { properties: { title } },
        })),
      }),
    }
  );
  if (!res.ok) {
    const errText = await res.text();
    throw new Error(
      `Failed to add missing worksheets (${res.status}): ${errText}`
    );
  }
}

function buildSheetRows(
  store: StoreData
): Array<{ range: string; values: unknown[][] }> {
  return [
    {
      range: 'Users!A1',
      values: [
        ['User ID', 'Email', 'Name', 'Role', 'Status', 'Created At', 'Updated At'],
        ...store.users.map((u) => [
          u.userId,
          u.email,
          u.name,
          u.role,
          u.status,
          u.createdAt,
          u.updatedAt,
        ]),
      ],
    },
    {
      range: 'Projects!A1',
      values: [
        [
          'Project ID',
          'Project Name',
          'Description',
          'Owner User ID',
          'Created By',
          'Status',
          'Use Project Config',
          'Active Config Version',
          'Created At',
          'Updated At',
        ],
        ...store.projects.map((p) => [
          p.projectId,
          p.name,
          p.description,
          p.ownerUserId,
          p.createdBy,
          p.status,
          p.useProjectConfig ? 'Yes' : 'No',
          p.activeConfigVersion,
          p.createdAt,
          p.updatedAt,
        ]),
      ],
    },
    {
      range: 'ProjectMemberships!A1',
      values: [
        [
          'Membership ID',
          'Project ID',
          'User ID',
          'Project Role',
          'Membership Status',
          'Invited By',
          'Joined At',
          'Updated At',
        ],
        ...store.projectMemberships.map((m) => [
          m.membershipId,
          m.projectId,
          m.userId,
          m.projectRole,
          m.membershipStatus,
          m.invitedBy,
          m.joinedAt,
          m.updatedAt,
        ]),
      ],
    },
    {
      range: 'ProjectInvitations!A1',
      values: [
        [
          'Invitation ID',
          'Project ID',
          'Invitee Email',
          'Assigned Project Role',
          'Invited By',
          'Invitation Status',
          'Expiration',
          'Accepted At',
          'Created At',
        ],
        ...store.projectInvitations.map((inv) => [
          inv.invitationId,
          inv.projectId,
          inv.inviteeEmail,
          inv.assignedProjectRole,
          inv.invitedBy,
          inv.invitationStatus,
          inv.expiresAt,
          inv.acceptedAt || '',
          inv.createdAt,
        ]),
      ],
    },
    {
      range: 'ProjectConfigurationVersions!A1',
      values: [
        [
          'Configuration ID',
          'Project ID',
          'Version',
          'Configuration Data JSON',
          'Created By',
          'Created At',
        ],
        ...store.projectConfigurationVersions.map((pc) => [
          pc.configId,
          pc.projectId,
          pc.version,
          JSON.stringify(pc.configurationData),
          pc.createdBy,
          pc.createdAt,
        ]),
      ],
    },
    {
      range: 'WorkEntries!A1',
      values: [
        [
          'Work ID',
          'Project ID',
          'User ID',
          'Work Date',
          'Config Version',
          'Work Summary',
          'Category',
          'Status',
          'Semantic Status',
          'Sprint ID',
          'ADO Reference',
          'Related Work ID',
          'Field Values JSON',
          'Created By',
          'Created At',
          'Updated At',
        ],
        ...store.workEntries.map((w) => [
          w.workId,
          w.projectId,
          w.userId,
          w.workDate,
          w.configVersion,
          w.summary,
          w.category,
          w.status,
          w.semanticStatus,
          w.sprintId || '',
          w.adoReference || '',
          w.relatedWorkId || '',
          JSON.stringify(w.fieldValues),
          w.createdBy,
          w.createdAt,
          w.updatedAt,
        ]),
      ],
    },
    {
      range: 'DailySubmissions!A1',
      values: [
        [
          'Submission ID',
          'User ID',
          'Work Date',
          'Entry Count',
          'Status',
          'No Work Reason',
          'Submitted By',
          'Submitted At',
          'Reopened By',
          'Reopened At',
          'Reopen Reason',
        ],
        ...store.dailySubmissions.map((d) => [
          d.submissionId,
          d.userId,
          d.workDate,
          d.entryCount,
          d.status,
          d.noWorkReason || '',
          d.submittedBy,
          d.submittedAt,
          d.reopenedBy || '',
          d.reopenedAt || '',
          d.reopenReason || '',
        ]),
      ],
    },
    {
      range: 'Sprints!A1',
      values: [
        [
          'Sprint ID',
          'Project ID',
          'Name',
          'Objective',
          'Start Date',
          'End Date',
          'Status',
          'Created By',
          'Created At',
          'Updated At',
        ],
        ...store.sprints.map((s) => [
          s.sprintId,
          s.projectId,
          s.name,
          s.objective,
          s.startDate,
          s.endDate,
          s.status,
          s.createdBy,
          s.createdAt,
          s.updatedAt,
        ]),
      ],
    },
    {
      range: 'WorkFieldDefinitions!A1',
      values: [
        [
          'Field ID',
          'Label',
          'Field Type',
          'System Role',
          'Required',
          'Display Order',
          'Active',
          'Archived',
          'Placeholder',
          'Help Text',
          'Default Value',
          'Validation JSON',
          'Created At',
          'Updated At',
        ],
        ...store.workFieldDefinitions.map((f) => [
          f.fieldId,
          f.label,
          f.fieldType,
          f.systemRole,
          f.required ? 'Yes' : 'No',
          f.displayOrder,
          f.active ? 'Yes' : 'No',
          f.archived ? 'Yes' : 'No',
          f.placeholder,
          f.helpText,
          f.defaultValue !== undefined ? JSON.stringify(f.defaultValue) : '',
          f.validation ? JSON.stringify(f.validation) : '',
          f.createdAt,
          f.updatedAt,
        ]),
      ],
    },
    {
      range: 'WorkFieldOptions!A1',
      values: [
        [
          'Option ID',
          'Field ID',
          'Label',
          'Value',
          'Semantic Status',
          'Display Order',
          'Active',
          'Created At',
          'Updated At',
        ],
        ...store.workFieldOptions.map((o) => [
          o.optionId,
          o.fieldId,
          o.label,
          o.value,
          o.semanticStatus || '',
          o.displayOrder,
          o.active ? 'Yes' : 'No',
          o.createdAt,
          o.updatedAt,
        ]),
      ],
    },
    {
      range: 'WorkFieldConfigurationVersions!A1',
      values: [
        ['Version', 'Created By', 'Created At', 'Fields JSON', 'Options JSON'],
        ...store.workFieldConfigurationVersions.map((v) => [
          v.version,
          v.createdBy,
          v.createdAt,
          JSON.stringify(v.fields),
          JSON.stringify(v.options),
        ]),
      ],
    },
    {
      range: 'AuditLogs!A1',
      values: [
        [
          'Audit ID',
          'Actor ID',
          'Actor Email',
          'Actor Role',
          'Action',
          'Entity Type',
          'Entity ID',
          'Project ID',
          'Previous Value',
          'New Value',
          'Timestamp',
        ],
        ...store.auditLogs.slice(0, 1000).map((a) => [
          a.auditId,
          a.actorId,
          a.actorEmail,
          a.actorRole,
          a.action,
          a.entityType,
          a.entityId,
          a.projectId || '',
          a.previousValue ? JSON.stringify(a.previousValue) : '',
          a.newValue ? JSON.stringify(a.newValue) : '',
          a.timestamp,
        ]),
      ],
    },
    {
      range: 'SystemSettings!A1',
      values: [
        ['Key', 'Value'],
        ['companyName', store.systemSettings.companyName],
        ['timezone', store.systemSettings.timezone],
        ['workingDays', store.systemSettings.workingDays.join(',')],
        ['allowedDomains', store.systemSettings.allowedDomains.join(',')],
        [
          'blockPersonalDomains',
          String(store.systemSettings.blockPersonalDomains),
        ],
        [
          'allowMemberEntryDeletion',
          String(store.systemSettings.allowMemberEntryDeletion),
        ],
        ['minNoWorkReasonLength', store.systemSettings.minNoWorkReasonLength],
        ['activeConfigVersion', store.systemSettings.activeConfigVersion],
      ],
    },
  ];
}

export async function syncStoreToGoogleSheet(
  accessToken: string,
  spreadsheetId: string,
  store: StoreData
): Promise<{ updatedCells: number; sheetUrl: string }> {
  const meta = await getSpreadsheetMetadata(accessToken, spreadsheetId);
  await ensureRequiredTabs(accessToken, spreadsheetId, meta.sheetTitles);

  const clearRes = await fetch(
    `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(
      spreadsheetId
    )}/values:batchClear`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        ranges: WORKSHEET_NAMES.map((name) => `${name}!A1:Z5000`),
      }),
    }
  );
  if (!clearRes.ok) {
    const errText = await clearRes.text();
    throw new Error(
      `Failed clearing worksheets (${clearRes.status}): ${errText}`
    );
  }

  const data = buildSheetRows(store);
  const updateRes = await fetch(
    `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(
      spreadsheetId
    )}/values:batchUpdate`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        valueInputOption: 'USER_ENTERED',
        data,
      }),
    }
  );

  if (!updateRes.ok) {
    const errText = await updateRes.text();
    throw new Error(
      `Google Sheets batchUpdate failed (${updateRes.status}): ${errText}`
    );
  }

  const result = (await updateRes.json()) as { totalUpdatedCells?: number };
  return {
    updatedCells: result.totalUpdatedCells || 0,
    sheetUrl: meta.spreadsheetUrl,
  };
}
