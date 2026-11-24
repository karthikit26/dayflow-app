import 'dotenv/config';
import express, { type NextFunction, type Request, type Response } from 'express';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { createServer as createViteServer } from 'vite';
import {
  requireAdminOrSuperAdmin,
  requireAuth,
  requireSuperAdmin,
  type AuthenticatedRequest,
} from './server/auth';
import {
  assertNoRoleEscalation,
  canAccessProject,
  canCreateProject,
  canManageProject,
  canModifyWorkEntry,
  getAccessibleProjectIds,
  getManageableProjectIds,
} from './server/authz';
import {
  createDayFlowSpreadsheet,
  getSpreadsheetMetadata,
  syncStoreToGoogleSheet,
} from './server/googleWorkspace';
import {
  appendAudit,
  assertDayNotLocked,
  computeAccessibleProjects,
  computeSprintOverviews,
  computeTeamDailyOverview,
  generateWeeklyTeamUpdate,
  getEffectiveProjectConfig,
  getEntryConfigForValidation,
  sanitizeUserForViewer,
  ServiceError,
  snapshotGlobalConfigVersion,
  snapshotProjectConfigVersion,
} from './server/services';
import { repository } from './server/store';
import {
  completeDaySchema,
  dateRegex,
  fieldCreateSchema,
  fieldOptionCreateSchema,
  fieldOptionUpdateSchema,
  fieldUpdateSchema,
  getDateTimePartsInTimezone,
  projectCreateSchema,
  projectInvitationCreateSchema,
  projectMembershipPatchSchema,
  projectUpdateSchema,
  reopenDaySchema,
  settingsUpdateSchema,
  sprintCreateSchema,
  sprintUpdateSchema,
  userCreateSchema,
  userUpdateSchema,
  validateDynamicFieldValues,
  workEntryPatchSchema,
  workEntryPayloadSchema,
} from './server/validators';
import type {
  Project,
  ProjectConfigurationVersion,
  ProjectInvitation,
  ProjectMembership,
  SprintStatus,
  WorkFieldDefinition,
  WorkFieldOption,
} from './src/types';

const PORT = Number(process.env.PORT || 3000);
const IS_PROD = process.env.NODE_ENV === 'production';

const rateWindowMap = new Map<string, number[]>();
function rateLimit(maxRequests: number, windowMs: number) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const ip = req.ip || req.socket.remoteAddress || 'unknown';
    const key = `${ip}:${req.method === 'GET' ? 'read' : 'write'}`;
    const now = Date.now();
    const timestamps = (rateWindowMap.get(key) || []).filter(
      (t) => now - t < windowMs
    );
    if (timestamps.length >= maxRequests) {
      res.status(429).json({ error: 'Too many requests. Please slow down.' });
      return;
    }
    timestamps.push(now);
    rateWindowMap.set(key, timestamps);
    next();
  };
}

function sameOriginGuard(req: Request, res: Response, next: NextFunction): void {
  const origin = req.headers.origin;
  if (origin) {
    const rawForwarded = req.headers['x-forwarded-host'];
    const forwardedHost = Array.isArray(rawForwarded)
      ? rawForwarded[0]
      : rawForwarded?.split(',')[0]?.trim();
    const host = forwardedHost || req.headers.host;
    try {
      const originHost = new URL(origin).host;
      if (host && originHost !== host) {
        res.status(403).json({ error: 'Cross-origin request rejected' });
        return;
      }
    } catch {
      res.status(403).json({ error: 'Invalid Origin header' });
      return;
    }
  }
  next();
}

async function startServer() {
  const app = express();
  app.set('trust proxy', 1);
  app.use(express.json({ limit: '1mb' }));

  app.use((_req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    next();
  });

  app.use('/api', sameOriginGuard);
  app.use('/api', rateLimit(300, 60_000));

  app.get('/api/health', (_req, res) => {
    res.json({ status: 'ok', timestamp: new Date().toISOString() });
  });

  // BOOTSTRAP (Strictly Role & Project Isolated)
  app.get('/api/bootstrap', requireAuth, async (req: AuthenticatedRequest, res: Response) => {
    const user = req.authMember!;
    const nowIso = new Date().toISOString();

    // Expire overdue pending invitations cleanly on read if needed
    const store = await repository.mutate((draft) => {
      for (const inv of draft.projectInvitations) {
        if (inv.invitationStatus === 'Pending' && inv.expiresAt <= nowIso) {
          inv.invitationStatus = 'Expired';
        }
      }
      return structuredClone(draft);
    });

    const { dateStr: todayInTz, timeStr: timeInTz } = getDateTimePartsInTimezone(
      new Date(),
      store.systemSettings.timezone
    );

    const isSuperAdmin = user.role === 'SUPER_ADMIN';
    const isAdmin = user.role === 'ADMIN';
    const accessibleProjectIds = getAccessibleProjectIds(store, user);
    const manageableProjectIds = getManageableProjectIds(store, user);

    const projects = computeAccessibleProjects(store, user);
    const sprints = computeSprintOverviews(store, accessibleProjectIds);
    const teamDailyOverview = computeTeamDailyOverview(store, user, todayInTz);

    // Filter memberships strictly to accessible projects
    const visibleMemberships = store.projectMemberships.filter((m) =>
      accessibleProjectIds.has(m.projectId)
    );

    // Users visible to caller:
    // - SUPER_ADMIN: all users
    // - ADMIN: active users who share accessible projects + existing Admins (so they can invite Admin/Member) + Members
    // - MEMBER: active users who share accessible projects
    const sharedUserIds = new Set<string>([user.userId]);
    for (const m of visibleMemberships) {
      sharedUserIds.add(m.userId);
    }

    const visibleUsers = isSuperAdmin
      ? store.users
      : isAdmin
      ? store.users
          .filter(
            (u) =>
              u.role !== 'SUPER_ADMIN' &&
              (sharedUserIds.has(u.userId) || u.status === 'Active')
          )
          .map((u) => sanitizeUserForViewer(u, user, true))
      : store.users
          .filter((u) => u.status === 'Active' && sharedUserIds.has(u.userId))
          .map((u) => sanitizeUserForViewer(u, user, false));

    // Pending invitations: those addressed to the current user + invitations for projects caller manages
    const visibleInvitations = store.projectInvitations.filter(
      (inv) =>
        inv.inviteeEmail.toLowerCase() === user.email.toLowerCase() ||
        manageableProjectIds.has(inv.projectId)
    );

    // Work entries strictly filtered to accessible projects & permission scope
    const visibleWorkEntries = isSuperAdmin
      ? store.workEntries
      : isAdmin
      ? store.workEntries.filter(
          (w) =>
            accessibleProjectIds.has(w.projectId) &&
            (manageableProjectIds.has(w.projectId) || w.userId === user.userId)
        )
      : store.workEntries.filter(
          (w) =>
            accessibleProjectIds.has(w.projectId) && w.userId === user.userId
        );

    const visibleSubmissions = isSuperAdmin
      ? store.dailySubmissions
      : isAdmin
      ? store.dailySubmissions.filter((s) => sharedUserIds.has(s.userId))
      : store.dailySubmissions.filter((s) => s.userId === user.userId);

    // Effective project config map for accessible projects
    const projectConfigs: Record<
      string,
      {
        version: number;
        fields: WorkFieldDefinition[];
        options: WorkFieldOption[];
        isProjectOverride: boolean;
      }
    > = {};
    for (const pid of accessibleProjectIds) {
      projectConfigs[pid] = getEffectiveProjectConfig(store, pid);
    }

    const visibleProjectConfigVersions = store.projectConfigurationVersions.filter(
      (cv) => accessibleProjectIds.has(cv.projectId)
    );

    // Global settings hidden for non-Super Admin except non-sensitive display/policy needed for UI
    const exposedSystemSettings = isSuperAdmin
      ? store.systemSettings
      : {
          ...store.systemSettings,
          allowedDomains: [],
          linkedSpreadsheetId: undefined,
          linkedSpreadsheetUrl: undefined,
        };

    res.json({
      currentUser: user,
      todayInTz,
      timeInTz,
      systemSettings: exposedSystemSettings,
      users: visibleUsers,
      projects,
      projectMemberships: visibleMemberships,
      projectInvitations: visibleInvitations,
      projectConfigs,
      projectConfigurationVersions: visibleProjectConfigVersions,
      sprints,
      teamDailyOverview,
      workEntries: visibleWorkEntries,
      dailySubmissions: visibleSubmissions,
      workFieldDefinitions: store.workFieldDefinitions
        .slice()
        .sort((a, b) => a.displayOrder - b.displayOrder),
      workFieldOptions: store.workFieldOptions
        .slice()
        .sort((a, b) => a.displayOrder - b.displayOrder),
      workFieldConfigurationVersions: store.workFieldConfigurationVersions,
      auditLogs: isSuperAdmin ? store.auditLogs.slice(0, 500) : [],
    });
  });

  // =========================================================================
  // PROJECTS & ACCESS CONTROL
  // =========================================================================
  app.post('/api/projects', requireAuth, requireAdminOrSuperAdmin, async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const actor = req.authMember!;
      if (!canCreateProject(actor)) {
        throw new ServiceError(403, 'You are not authorized to create projects.');
      }
      const parsed = projectCreateSchema.safeParse(req.body);
      if (!parsed.success) {
        throw new ServiceError(400, parsed.error.issues[0]?.message || 'Invalid project data');
      }
      const input = parsed.data;

      const created = await repository.mutate((draft) => {
        if (
          draft.projects.some(
            (p) => p.name.toLowerCase() === input.name.toLowerCase()
          )
        ) {
          throw new ServiceError(409, `A project named "${input.name}" already exists.`);
        }

        const nowIso = new Date().toISOString();
        const projectId = `PRJ-${String(draft.projects.length + 1).padStart(3, '0')}`;
        const project: Project = {
          projectId,
          name: input.name,
          description: input.description,
          ownerUserId: actor.userId,
          createdBy: actor.email,
          status: input.status,
          useProjectConfig: input.useProjectConfig,
          activeConfigVersion: 1,
          createdAt: nowIso,
          updatedAt: nowIso,
        };
        draft.projects.unshift(project);

        // Creator automatically receives PROJECT_ADMIN membership
        const membership: ProjectMembership = {
          membershipId: `PMB-${String(draft.projectMemberships.length + 1).padStart(4, '0')}`,
          projectId,
          userId: actor.userId,
          projectRole: 'PROJECT_ADMIN',
          membershipStatus: 'Active',
          invitedBy: actor.email,
          joinedAt: nowIso,
          updatedAt: nowIso,
        };
        draft.projectMemberships.push(membership);

        // Snapshot initial project configuration from global defaults
        const cfg: ProjectConfigurationVersion = {
          configId: `PCFG-${String(draft.projectConfigurationVersions.length + 1).padStart(4, '0')}`,
          projectId,
          version: 1,
          configurationData: {
            fields: structuredClone(draft.workFieldDefinitions),
            options: structuredClone(draft.workFieldOptions),
          },
          createdBy: actor.email,
          createdAt: nowIso,
        };
        draft.projectConfigurationVersions.push(cfg);

        appendAudit(draft, {
          actorId: actor.userId,
          actorEmail: actor.email,
          actorRole: actor.role,
          action: 'PROJECT_CREATED',
          entityType: 'Project',
          entityId: projectId,
          projectId,
          newValue: project,
        });

        return project;
      });

      res.status(201).json(created);
    } catch (err) {
      next(err);
    }
  });

  app.patch('/api/projects/:projectId', requireAuth, requireAdminOrSuperAdmin, async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const actor = req.authMember!;
      const projectId = String(req.params.projectId);
      const parsed = projectUpdateSchema.safeParse(req.body);
      if (!parsed.success) {
        throw new ServiceError(400, parsed.error.issues[0]?.message || 'Invalid project update');
      }
      const patch = parsed.data;

      const updated = await repository.mutate((draft) => {
        const project = draft.projects.find((p) => p.projectId === projectId);
        if (!project) throw new ServiceError(404, 'Project not found.');
        if (!canManageProject(draft, actor, projectId)) {
          throw new ServiceError(403, 'You do not have Project Admin access for this project.');
        }

        // Archiving restriction: only Super Admin or Project Owner (with Project Admin access) can archive
        if (
          patch.status === 'Archived' &&
          actor.role !== 'SUPER_ADMIN' &&
          project.ownerUserId !== actor.userId
        ) {
          throw new ServiceError(
            403,
            'Only the Project Owner or a Super Admin can archive this project.'
          );
        }

        const prev = structuredClone(project);
        if (patch.name !== undefined) project.name = patch.name;
        if (patch.description !== undefined) project.description = patch.description;
        if (patch.status !== undefined) project.status = patch.status;
        if (patch.useProjectConfig !== undefined) {
          project.useProjectConfig = patch.useProjectConfig;
        }
        project.updatedAt = new Date().toISOString();

        appendAudit(draft, {
          actorId: actor.userId,
          actorEmail: actor.email,
          actorRole: actor.role,
          action: 'PROJECT_UPDATED',
          entityType: 'Project',
          entityId: projectId,
          projectId,
          previousValue: prev,
          newValue: structuredClone(project),
        });
        return project;
      });

      res.json(updated);
    } catch (err) {
      next(err);
    }
  });

  app.post('/api/projects/:projectId/transfer-ownership', requireAuth, requireSuperAdmin, async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const superAdmin = req.authMember!;
      const projectId = String(req.params.projectId);
      const newOwnerUserId = String(req.body?.newOwnerUserId || '').trim();
      if (!newOwnerUserId) {
        throw new ServiceError(400, 'Target newOwnerUserId is required.');
      }

      const updated = await repository.mutate((draft) => {
        const project = draft.projects.find((p) => p.projectId === projectId);
        if (!project) throw new ServiceError(404, 'Project not found.');
        const targetUser = draft.users.find(
          (u) => u.userId === newOwnerUserId && u.status === 'Active'
        );
        if (!targetUser) {
          throw new ServiceError(404, 'Target owner account not found or inactive.');
        }
        if (targetUser.role === 'MEMBER') {
          throw new ServiceError(
            400,
            'Project ownership can only be transferred to an active Admin or Super Admin.'
          );
        }

        const prevOwner = project.ownerUserId;
        const nowIso = new Date().toISOString();
        project.ownerUserId = targetUser.userId;
        project.updatedAt = nowIso;

        // Ensure new owner holds active PROJECT_ADMIN membership
        const existingMem = draft.projectMemberships.find(
          (m) => m.projectId === projectId && m.userId === targetUser.userId
        );
        if (existingMem) {
          existingMem.projectRole = 'PROJECT_ADMIN';
          existingMem.membershipStatus = 'Active';
          existingMem.updatedAt = nowIso;
        } else {
          draft.projectMemberships.push({
            membershipId: `PMB-${String(draft.projectMemberships.length + 1).padStart(4, '0')}`,
            projectId,
            userId: targetUser.userId,
            projectRole: 'PROJECT_ADMIN',
            membershipStatus: 'Active',
            invitedBy: superAdmin.email,
            joinedAt: nowIso,
            updatedAt: nowIso,
          });
        }

        appendAudit(draft, {
          actorId: superAdmin.userId,
          actorEmail: superAdmin.email,
          actorRole: superAdmin.role,
          action: 'PROJECT_OWNERSHIP_TRANSFERRED',
          entityType: 'Project',
          entityId: projectId,
          projectId,
          previousValue: { ownerUserId: prevOwner },
          newValue: { ownerUserId: targetUser.userId, ownerEmail: targetUser.email },
        });
        return project;
      });

      res.json(updated);
    } catch (err) {
      next(err);
    }
  });

  // PROJECT INVITATIONS
  app.post('/api/projects/:projectId/invitations', requireAuth, requireAdminOrSuperAdmin, async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const actor = req.authMember!;
      const projectId = String(req.params.projectId);
      const parsed = projectInvitationCreateSchema.safeParse(req.body);
      if (!parsed.success) {
        throw new ServiceError(400, parsed.error.issues[0]?.message || 'Invalid invitation');
      }
      const { email, projectRole, expiresInDays } = parsed.data;

      const created = await repository.mutate((draft) => {
        const project = draft.projects.find((p) => p.projectId === projectId);
        if (!project) throw new ServiceError(404, 'Project not found.');
        if (!canManageProject(draft, actor, projectId)) {
          throw new ServiceError(
            403,
            'You are not authorized to invite users to this project.'
          );
        }

        const nowIso = new Date().toISOString();
        const existingUser = draft.users.find(
          (u) => u.email.toLowerCase() === email
        );

        // Enforce role escalation rules on invitation creation
        if (projectRole === 'PROJECT_ADMIN') {
          if (existingUser) {
            const escErr = assertNoRoleEscalation(
              actor,
              existingUser.role,
              projectRole
            );
            if (escErr) throw new ServiceError(403, escErr);
          } else {
            throw new ServiceError(
              400,
              'Project Admin access can only be invited for an existing Admin or Super Admin account.'
            );
          }
        }

        // Prevent inviting an existing active member again
        if (existingUser) {
          const activeMem = draft.projectMemberships.find(
            (m) =>
              m.projectId === projectId &&
              m.userId === existingUser.userId &&
              m.membershipStatus === 'Active'
          );
          if (activeMem) {
            throw new ServiceError(
              409,
              `${email} already has active access to this project.`
            );
          }
        }

        // Prevent duplicate pending non-expired invitations
        const dupInvite = draft.projectInvitations.find(
          (inv) =>
            inv.projectId === projectId &&
            inv.inviteeEmail.toLowerCase() === email &&
            inv.invitationStatus === 'Pending' &&
            inv.expiresAt > nowIso
        );
        if (dupInvite) {
          throw new ServiceError(
            409,
            `A pending invitation already exists for ${email} on this project.`
          );
        }

        const expiresAt = new Date(
          Date.now() + expiresInDays * 24 * 60 * 60 * 1000
        ).toISOString();

        const invitation: ProjectInvitation = {
          invitationId: `INV-${String(draft.projectInvitations.length + 1).padStart(4, '0')}`,
          projectId,
          inviteeEmail: email,
          assignedProjectRole: projectRole,
          invitedBy: actor.email,
          invitationStatus: 'Pending',
          expiresAt,
          createdAt: nowIso,
        };
        draft.projectInvitations.unshift(invitation);

        appendAudit(draft, {
          actorId: actor.userId,
          actorEmail: actor.email,
          actorRole: actor.role,
          action: 'PROJECT_INVITATION_CREATED',
          entityType: 'ProjectInvitation',
          entityId: invitation.invitationId,
          projectId,
          newValue: invitation,
        });

        return invitation;
      });

      res.status(201).json(created);
    } catch (err) {
      next(err);
    }
  });

  app.post('/api/invitations/:invitationId/accept', requireAuth, async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const actor = req.authMember!;
      const invitationId = String(req.params.invitationId);

      const result = await repository.mutate((draft) => {
        const inv = draft.projectInvitations.find(
          (i) => i.invitationId === invitationId
        );
        if (!inv) throw new ServiceError(404, 'Invitation not found.');

        if (inv.inviteeEmail.toLowerCase() !== actor.email.toLowerCase()) {
          throw new ServiceError(
            403,
            'This invitation is addressed to a different user email.'
          );
        }
        if (inv.invitationStatus === 'Revoked') {
          throw new ServiceError(410, 'This invitation has been revoked.');
        }
        if (inv.invitationStatus === 'Accepted') {
          throw new ServiceError(409, 'This invitation has already been accepted.');
        }

        const nowIso = new Date().toISOString();
        if (inv.invitationStatus === 'Expired' || inv.expiresAt <= nowIso) {
          inv.invitationStatus = 'Expired';
          throw new ServiceError(410, 'This invitation has expired.');
        }

        // Prevent privilege escalation if user's global role is MEMBER
        const finalRole =
          actor.role === 'MEMBER' ? 'PROJECT_MEMBER' : inv.assignedProjectRole;

        inv.invitationStatus = 'Accepted';
        inv.acceptedAt = nowIso;

        const existingMem = draft.projectMemberships.find(
          (m) => m.projectId === inv.projectId && m.userId === actor.userId
        );
        let membership: ProjectMembership;
        if (existingMem) {
          existingMem.projectRole = finalRole;
          existingMem.membershipStatus = 'Active';
          existingMem.updatedAt = nowIso;
          membership = existingMem;
        } else {
          membership = {
            membershipId: `PMB-${String(draft.projectMemberships.length + 1).padStart(4, '0')}`,
            projectId: inv.projectId,
            userId: actor.userId,
            projectRole: finalRole,
            membershipStatus: 'Active',
            invitedBy: inv.invitedBy,
            joinedAt: nowIso,
            updatedAt: nowIso,
          };
          draft.projectMemberships.push(membership);
        }

        appendAudit(draft, {
          actorId: actor.userId,
          actorEmail: actor.email,
          actorRole: actor.role,
          action: 'PROJECT_INVITATION_ACCEPTED',
          entityType: 'ProjectInvitation',
          entityId: inv.invitationId,
          projectId: inv.projectId,
          newValue: { membershipId: membership.membershipId, projectRole: finalRole },
        });

        return { invitation: inv, membership };
      });

      res.json(result);
    } catch (err) {
      next(err);
    }
  });

  app.post('/api/invitations/:invitationId/revoke', requireAuth, requireAdminOrSuperAdmin, async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const actor = req.authMember!;
      const invitationId = String(req.params.invitationId);

      const updated = await repository.mutate((draft) => {
        const inv = draft.projectInvitations.find(
          (i) => i.invitationId === invitationId
        );
        if (!inv) throw new ServiceError(404, 'Invitation not found.');
        if (!canManageProject(draft, actor, inv.projectId)) {
          throw new ServiceError(403, 'Not authorized to revoke invitations for this project.');
        }
        if (inv.invitationStatus !== 'Pending') {
          throw new ServiceError(400, `Cannot revoke an invitation in status "${inv.invitationStatus}".`);
        }
        const nowIso = new Date().toISOString();
        inv.invitationStatus = 'Revoked';
        inv.revokedBy = actor.email;
        inv.revokedAt = nowIso;

        appendAudit(draft, {
          actorId: actor.userId,
          actorEmail: actor.email,
          actorRole: actor.role,
          action: 'PROJECT_INVITATION_REVOKED',
          entityType: 'ProjectInvitation',
          entityId: inv.invitationId,
          projectId: inv.projectId,
          newValue: { inviteeEmail: inv.inviteeEmail },
        });
        return inv;
      });

      res.json(updated);
    } catch (err) {
      next(err);
    }
  });

  // PROJECT MEMBERSHIPS MANAGEMENT
  app.patch('/api/projects/:projectId/memberships/:membershipId', requireAuth, requireAdminOrSuperAdmin, async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const actor = req.authMember!;
      const projectId = String(req.params.projectId);
      const membershipId = String(req.params.membershipId);
      const parsed = projectMembershipPatchSchema.safeParse(req.body);
      if (!parsed.success) {
        throw new ServiceError(400, parsed.error.issues[0]?.message || 'Invalid membership update');
      }
      const patch = parsed.data;

      const updated = await repository.mutate((draft) => {
        const project = draft.projects.find((p) => p.projectId === projectId);
        if (!project) throw new ServiceError(404, 'Project not found.');
        if (!canManageProject(draft, actor, projectId)) {
          throw new ServiceError(403, 'Not authorized to manage project memberships.');
        }

        const membership = draft.projectMemberships.find(
          (m) => m.membershipId === membershipId && m.projectId === projectId
        );
        if (!membership) throw new ServiceError(404, 'Membership record not found.');

        const targetUser = draft.users.find((u) => u.userId === membership.userId);
        if (!targetUser) throw new ServiceError(404, 'User not found.');

        if (targetUser.role === 'SUPER_ADMIN' && actor.role !== 'SUPER_ADMIN') {
          throw new ServiceError(403, 'Admins cannot modify Super Admin memberships.');
        }

        if (
          project.ownerUserId === membership.userId &&
          actor.role !== 'SUPER_ADMIN' &&
          (patch.membershipStatus === 'Inactive' || patch.projectRole === 'PROJECT_MEMBER')
        ) {
          throw new ServiceError(
            403,
            'Cannot demote or deactivate the Project Owner. Ask a Super Admin to transfer ownership first.'
          );
        }

        if (patch.projectRole) {
          const escErr = assertNoRoleEscalation(
            actor,
            targetUser.role,
            patch.projectRole
          );
          if (escErr) throw new ServiceError(403, escErr);
        }

        const prev = structuredClone(membership);
        if (patch.projectRole !== undefined) membership.projectRole = patch.projectRole;
        if (patch.membershipStatus !== undefined) {
          membership.membershipStatus = patch.membershipStatus;
        }
        membership.updatedAt = new Date().toISOString();

        appendAudit(draft, {
          actorId: actor.userId,
          actorEmail: actor.email,
          actorRole: actor.role,
          action: 'PROJECT_MEMBERSHIP_UPDATED',
          entityType: 'ProjectMembership',
          entityId: membershipId,
          projectId,
          previousValue: prev,
          newValue: structuredClone(membership),
        });
        return membership;
      });

      res.json(updated);
    } catch (err) {
      next(err);
    }
  });

  app.delete('/api/projects/:projectId/memberships/:membershipId', requireAuth, requireAdminOrSuperAdmin, async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const actor = req.authMember!;
      const projectId = String(req.params.projectId);
      const membershipId = String(req.params.membershipId);

      await repository.mutate((draft) => {
        const project = draft.projects.find((p) => p.projectId === projectId);
        if (!project) throw new ServiceError(404, 'Project not found.');
        if (!canManageProject(draft, actor, projectId)) {
          throw new ServiceError(403, 'Not authorized to remove members from this project.');
        }

        const idx = draft.projectMemberships.findIndex(
          (m) => m.membershipId === membershipId && m.projectId === projectId
        );
        if (idx === -1) throw new ServiceError(404, 'Membership record not found.');
        const membership = draft.projectMemberships[idx];

        const targetUser = draft.users.find((u) => u.userId === membership.userId);
        if (targetUser?.role === 'SUPER_ADMIN' && actor.role !== 'SUPER_ADMIN') {
          throw new ServiceError(403, 'Admins cannot remove Super Admin accounts.');
        }
        if (project.ownerUserId === membership.userId && actor.role !== 'SUPER_ADMIN') {
          throw new ServiceError(403, 'Cannot remove Project Owner from project.');
        }

        // Remove membership while strictly preserving historical workEntries
        const removed = draft.projectMemberships.splice(idx, 1)[0];
        appendAudit(draft, {
          actorId: actor.userId,
          actorEmail: actor.email,
          actorRole: actor.role,
          action: 'PROJECT_MEMBERSHIP_REMOVED',
          entityType: 'ProjectMembership',
          entityId: membershipId,
          projectId,
          previousValue: removed,
        });
      });

      res.json({ ok: true });
    } catch (err) {
      next(err);
    }
  });

  // =========================================================================
  // PROJECT-AWARE WORK ENTRIES
  // =========================================================================
  app.post('/api/work-entries', requireAuth, async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const actor = req.authMember!;
      const parsed = workEntryPayloadSchema.safeParse(req.body);
      if (!parsed.success) {
        throw new ServiceError(400, parsed.error.issues[0]?.message || 'Invalid work entry payload');
      }
      const { projectId, workDate, fieldValues, relatedWorkId } = parsed.data;

      const created = await repository.mutate((draft) => {
        const project = draft.projects.find((p) => p.projectId === projectId);
        if (!project) throw new ServiceError(404, 'Selected project does not exist.');
        if (project.status !== 'Active') {
          throw new ServiceError(
            403,
            `Project "${project.name}" is ${project.status} and cannot accept new work entries.`
          );
        }
        if (!canAccessProject(draft, actor, projectId)) {
          throw new ServiceError(
            403,
            'You do not have membership access to log work for this project.'
          );
        }

        const { dateStr: todayInTz } = getDateTimePartsInTimezone(
          new Date(),
          draft.systemSettings.timezone
        );
        if (workDate > todayInTz) {
          throw new ServiceError(400, `Cannot log work for a future date (${workDate}).`);
        }

        assertDayNotLocked(draft, actor.userId, workDate);

        const activeConfig = getEffectiveProjectConfig(draft, projectId);
        let validated;
        try {
          validated = validateDynamicFieldValues(
            draft,
            activeConfig.fields,
            activeConfig.options,
            fieldValues,
            projectId
          );
        } catch (err) {
          throw new ServiceError(400, err instanceof Error ? err.message : 'Validation failed');
        }

        const nowIso = new Date().toISOString();
        const workId = `WRK-${String(draft.workEntries.length + 1).padStart(4, '0')}`;
        const entry = {
          workId,
          projectId,
          userId: actor.userId,
          workDate,
          configVersion: activeConfig.version,
          fieldValues: validated.cleaned,
          summary: validated.summary,
          category: validated.category,
          status: validated.status,
          semanticStatus: validated.semanticStatus,
          sprintId: validated.sprintId,
          adoReference: validated.adoReference,
          relatedWorkId: relatedWorkId || undefined,
          createdBy: actor.email,
          createdAt: nowIso,
          updatedAt: nowIso,
        };

        draft.workEntries.unshift(entry);
        appendAudit(draft, {
          actorId: actor.userId,
          actorEmail: actor.email,
          actorRole: actor.role,
          action: 'WORK_ENTRY_CREATED',
          entityType: 'WorkEntry',
          entityId: entry.workId,
          projectId,
          newValue: entry,
        });

        return entry;
      });

      res.status(201).json(created);
    } catch (err) {
      next(err);
    }
  });

  app.patch('/api/work-entries/:workId', requireAuth, async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const actor = req.authMember!;
      const workId = String(req.params.workId);
      const parsed = workEntryPatchSchema.safeParse(req.body);
      if (!parsed.success) {
        throw new ServiceError(400, parsed.error.issues[0]?.message || 'Invalid update payload');
      }

      const updated = await repository.mutate((draft) => {
        const entry = draft.workEntries.find((w) => w.workId === workId);
        if (!entry) throw new ServiceError(404, 'Work entry not found.');

        if (!canModifyWorkEntry(draft, actor, entry)) {
          throw new ServiceError(403, 'You are not authorized to edit this work entry.');
        }

        assertDayNotLocked(draft, entry.userId, entry.workDate);

        const cfg = getEntryConfigForValidation(
          draft,
          entry.projectId,
          entry.configVersion
        );

        let validated;
        try {
          validated = validateDynamicFieldValues(
            draft,
            cfg.fields,
            cfg.options,
            parsed.data.fieldValues,
            entry.projectId
          );
        } catch (err) {
          throw new ServiceError(400, err instanceof Error ? err.message : 'Validation failed');
        }

        const previous = structuredClone(entry);
        entry.fieldValues = validated.cleaned;
        entry.summary = validated.summary;
        entry.category = validated.category;
        entry.status = validated.status;
        entry.semanticStatus = validated.semanticStatus;
        entry.sprintId = validated.sprintId;
        entry.adoReference = validated.adoReference;
        if (parsed.data.relatedWorkId !== undefined) {
          entry.relatedWorkId = parsed.data.relatedWorkId || undefined;
        }
        entry.updatedAt = new Date().toISOString();

        appendAudit(draft, {
          actorId: actor.userId,
          actorEmail: actor.email,
          actorRole: actor.role,
          action:
            entry.userId !== actor.userId
              ? 'ADMIN_WORK_ENTRY_CORRECTED'
              : 'WORK_ENTRY_UPDATED',
          entityType: 'WorkEntry',
          entityId: entry.workId,
          projectId: entry.projectId,
          previousValue: previous,
          newValue: structuredClone(entry),
        });

        return entry;
      });

      res.json(updated);
    } catch (err) {
      next(err);
    }
  });

  app.delete('/api/work-entries/:workId', requireAuth, async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const actor = req.authMember!;
      const workId = String(req.params.workId);
      await repository.mutate((draft) => {
        const idx = draft.workEntries.findIndex((w) => w.workId === workId);
        if (idx === -1) throw new ServiceError(404, 'Work entry not found.');
        const entry = draft.workEntries[idx];

        if (!canModifyWorkEntry(draft, actor, entry)) {
          throw new ServiceError(403, 'You are not authorized to delete this work entry.');
        }
        if (
          actor.role === 'MEMBER' &&
          !draft.systemSettings.allowMemberEntryDeletion
        ) {
          throw new ServiceError(403, 'Entry deletion is disabled by system policy.');
        }

        assertDayNotLocked(draft, entry.userId, entry.workDate);

        const removed = draft.workEntries.splice(idx, 1)[0];
        appendAudit(draft, {
          actorId: actor.userId,
          actorEmail: actor.email,
          actorRole: actor.role,
          action: 'WORK_ENTRY_DELETED',
          entityType: 'WorkEntry',
          entityId: workId,
          projectId: entry.projectId,
          previousValue: removed,
        });
      });
      res.json({ ok: true });
    } catch (err) {
      next(err);
    }
  });

  // =========================================================================
  // DAILY SUBMISSIONS
  // =========================================================================
  app.post('/api/submissions/complete-day', requireAuth, async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const actor = req.authMember!;
      const parsed = completeDaySchema.safeParse(req.body);
      if (!parsed.success) {
        throw new ServiceError(400, parsed.error.issues[0]?.message || 'Invalid submission request');
      }
      const { workDate, noWorkReason } = parsed.data;

      const submission = await repository.mutate((draft) => {
        const { dateStr: todayInTz } = getDateTimePartsInTimezone(
          new Date(),
          draft.systemSettings.timezone
        );
        if (workDate > todayInTz) {
          throw new ServiceError(400, 'Cannot complete daily submission for a future date.');
        }

        const existing = draft.dailySubmissions.find(
          (s) => s.userId === actor.userId && s.workDate === workDate
        );
        if (existing && existing.status === 'Submitted') {
          throw new ServiceError(409, 'Daily report for this date is already submitted.');
        }

        const entries = draft.workEntries.filter(
          (w) => w.userId === actor.userId && w.workDate === workDate
        );

        const minReason = draft.systemSettings.minNoWorkReasonLength || 10;
        if (entries.length === 0 && noWorkReason.trim().length < minReason) {
          throw new ServiceError(
            400,
            `At least one work entry is required, or provide a valid no-work reason (minimum ${minReason} characters).`
          );
        }

        for (const entry of entries) {
          const cfg = getEntryConfigForValidation(
            draft,
            entry.projectId,
            entry.configVersion
          );
          try {
            validateDynamicFieldValues(
              draft,
              cfg.fields,
              cfg.options,
              entry.fieldValues,
              entry.projectId
            );
          } catch (err) {
            throw new ServiceError(
              400,
              `Entry "${entry.summary}" (${entry.workId}) failed validation: ${
                err instanceof Error ? err.message : 'Invalid field'
              }`
            );
          }
        }

        const nowIso = new Date().toISOString();
        let record = existing;
        if (record) {
          record.entryCount = entries.length;
          record.status = 'Submitted';
          record.noWorkReason = entries.length === 0 ? noWorkReason : undefined;
          record.submittedBy = actor.email;
          record.submittedAt = nowIso;
          record.correctionHistory.push({
            correctedAt: nowIso,
            actorId: actor.userId,
            actorEmail: actor.email,
            action: 'Resubmit',
            reason: 'Resubmitted after Admin reopen',
          });
        } else {
          record = {
            submissionId: `SUB-${String(draft.dailySubmissions.length + 1).padStart(4, '0')}`,
            userId: actor.userId,
            workDate,
            entryCount: entries.length,
            status: 'Submitted',
            noWorkReason: entries.length === 0 ? noWorkReason : undefined,
            submittedBy: actor.email,
            submittedAt: nowIso,
            correctionHistory: [],
          };
          draft.dailySubmissions.unshift(record);
        }

        appendAudit(draft, {
          actorId: actor.userId,
          actorEmail: actor.email,
          actorRole: actor.role,
          action: 'DAILY_SUBMISSION_COMPLETED',
          entityType: 'DailySubmission',
          entityId: record.submissionId,
          newValue: {
            workDate,
            entryCount: record.entryCount,
            noWorkReason: record.noWorkReason,
          },
        });

        return record;
      });

      res.status(201).json(submission);
    } catch (err) {
      next(err);
    }
  });

  app.post('/api/submissions/reopen', requireAuth, requireAdminOrSuperAdmin, async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const admin = req.authMember!;
      const parsed = reopenDaySchema.safeParse(req.body);
      if (!parsed.success) {
        throw new ServiceError(400, parsed.error.issues[0]?.message || 'Invalid reopen request');
      }
      const { userId, workDate, reason } = parsed.data;

      const updated = await repository.mutate((draft) => {
        const sub = draft.dailySubmissions.find(
          (s) => s.userId === userId && s.workDate === workDate
        );
        if (!sub) throw new ServiceError(404, 'Daily submission record not found.');
        if (sub.status === 'Reopened') {
          throw new ServiceError(400, 'This daily submission is already reopened.');
        }

        // Admin (non-SuperAdmin) can only reopen if they administer at least one project the member logged/belongs to
        if (admin.role !== 'SUPER_ADMIN') {
          const manageable = getManageableProjectIds(draft, admin);
          const dayEntries = draft.workEntries.filter(
            (w) => w.userId === userId && w.workDate === workDate
          );
          const sharesManaged =
            dayEntries.some((w) => manageable.has(w.projectId)) ||
            draft.projectMemberships.some(
              (m) =>
                m.userId === userId &&
                m.membershipStatus === 'Active' &&
                manageable.has(m.projectId)
            );
          if (!sharesManaged) {
            throw new ServiceError(
              403,
              'You can only reopen submissions for members within projects you administer.'
            );
          }
        }

        const prev = structuredClone(sub);
        const nowIso = new Date().toISOString();
        sub.status = 'Reopened';
        sub.reopenedBy = admin.email;
        sub.reopenedAt = nowIso;
        sub.reopenReason = reason;
        sub.correctionHistory.push({
          correctedAt: nowIso,
          actorId: admin.userId,
          actorEmail: admin.email,
          action: 'Reopen',
          reason,
        });

        appendAudit(draft, {
          actorId: admin.userId,
          actorEmail: admin.email,
          actorRole: admin.role,
          action: 'DAILY_SUBMISSION_REOPENED',
          entityType: 'DailySubmission',
          entityId: sub.submissionId,
          previousValue: prev,
          newValue: { status: sub.status, reopenReason: reason },
        });

        return sub;
      });

      res.json(updated);
    } catch (err) {
      next(err);
    }
  });

  // =========================================================================
  // PROJECT-SCOPED SPRINTS
  // =========================================================================
  app.post('/api/sprints', requireAuth, requireAdminOrSuperAdmin, async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const admin = req.authMember!;
      const parsed = sprintCreateSchema.safeParse(req.body);
      if (!parsed.success) {
        throw new ServiceError(400, parsed.error.issues[0]?.message || 'Invalid sprint data');
      }
      const input = parsed.data;
      if (input.endDate < input.startDate) {
        throw new ServiceError(400, 'Sprint end date cannot precede start date.');
      }

      const created = await repository.mutate((draft) => {
        if (!canManageProject(draft, admin, input.projectId)) {
          throw new ServiceError(
            403,
            'You do not have Project Admin permission to create sprints for this project.'
          );
        }
        const nowIso = new Date().toISOString();
        const sprintId = `SPR-${String(draft.sprints.length + 1).padStart(3, '0')}`;
        const sprint = {
          sprintId,
          projectId: input.projectId,
          name: input.name,
          objective: input.objective,
          startDate: input.startDate,
          endDate: input.endDate,
          status: input.status as SprintStatus,
          createdBy: admin.email,
          createdAt: nowIso,
          updatedAt: nowIso,
        };
        draft.sprints.unshift(sprint);
        appendAudit(draft, {
          actorId: admin.userId,
          actorEmail: admin.email,
          actorRole: admin.role,
          action: 'SPRINT_CREATED',
          entityType: 'Sprint',
          entityId: sprintId,
          projectId: input.projectId,
          newValue: sprint,
        });
        return sprint;
      });
      res.status(201).json(created);
    } catch (err) {
      next(err);
    }
  });

  app.patch('/api/sprints/:sprintId', requireAuth, requireAdminOrSuperAdmin, async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const admin = req.authMember!;
      const sprintId = String(req.params.sprintId);
      const parsed = sprintUpdateSchema.safeParse(req.body);
      if (!parsed.success) {
        throw new ServiceError(400, parsed.error.issues[0]?.message || 'Invalid sprint update');
      }
      const patch = parsed.data;

      const updated = await repository.mutate((draft) => {
        const sprint = draft.sprints.find((s) => s.sprintId === sprintId);
        if (!sprint) throw new ServiceError(404, 'Sprint not found.');
        if (!canManageProject(draft, admin, sprint.projectId)) {
          throw new ServiceError(
            403,
            'You do not have Project Admin permission to update this sprint.'
          );
        }

        const nextStart = patch.startDate ?? sprint.startDate;
        const nextEnd = patch.endDate ?? sprint.endDate;
        if (nextEnd < nextStart) {
          throw new ServiceError(400, 'Sprint end date cannot precede start date.');
        }

        const prev = structuredClone(sprint);
        sprint.name = patch.name ?? sprint.name;
        sprint.objective = patch.objective ?? sprint.objective;
        sprint.startDate = nextStart;
        sprint.endDate = nextEnd;
        if (patch.status) sprint.status = patch.status as SprintStatus;
        sprint.updatedAt = new Date().toISOString();

        appendAudit(draft, {
          actorId: admin.userId,
          actorEmail: admin.email,
          actorRole: admin.role,
          action: 'SPRINT_UPDATED',
          entityType: 'Sprint',
          entityId: sprintId,
          projectId: sprint.projectId,
          previousValue: prev,
          newValue: structuredClone(sprint),
        });
        return sprint;
      });
      res.json(updated);
    } catch (err) {
      next(err);
    }
  });

  // =========================================================================
  // GLOBAL USER MANAGEMENT (Strict 3-Tier Role Enforcement)
  // =========================================================================
  app.post('/api/team', requireAuth, requireAdminOrSuperAdmin, async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const actor = req.authMember!;
      const parsed = userCreateSchema.safeParse(req.body);
      if (!parsed.success) {
        throw new ServiceError(400, parsed.error.issues[0]?.message || 'Invalid user data');
      }
      const input = parsed.data;

      if (actor.role !== 'SUPER_ADMIN' && input.role !== 'MEMBER') {
        throw new ServiceError(
          403,
          'Only a Super Admin can create or promote global Admin or Super Admin accounts.'
        );
      }

      const created = await repository.mutate((draft) => {
        if (draft.users.some((u) => u.email.toLowerCase() === input.email)) {
          throw new ServiceError(409, `A user with ${input.email} already exists.`);
        }
        const nowIso = new Date().toISOString();
        const userId = `USR-${String(draft.users.length + 1).padStart(3, '0')}`;
        const user = {
          userId,
          email: input.email,
          name: input.name,
          role: input.role,
          status: input.status,
          createdAt: nowIso,
          updatedAt: nowIso,
        };
        draft.users.push(user);

        // Optional immediate project assignment when Admin adds a Member to an administered project
        if (input.projectId) {
          if (!canManageProject(draft, actor, input.projectId)) {
            throw new ServiceError(403, 'Not authorized to add members to that project.');
          }
          const assignedProjRole =
            input.role === 'MEMBER'
              ? 'PROJECT_MEMBER'
              : input.projectRole || 'PROJECT_MEMBER';
          draft.projectMemberships.push({
            membershipId: `PMB-${String(draft.projectMemberships.length + 1).padStart(4, '0')}`,
            projectId: input.projectId,
            userId: user.userId,
            projectRole: assignedProjRole,
            membershipStatus: 'Active',
            invitedBy: actor.email,
            joinedAt: nowIso,
            updatedAt: nowIso,
          });
        }

        appendAudit(draft, {
          actorId: actor.userId,
          actorEmail: actor.email,
          actorRole: actor.role,
          action: 'USER_CREATED',
          entityType: 'User',
          entityId: userId,
          projectId: input.projectId,
          newValue: user,
        });
        return user;
      });
      res.status(201).json(created);
    } catch (err) {
      next(err);
    }
  });

  app.patch('/api/team/:userId', requireAuth, requireAdminOrSuperAdmin, async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const actor = req.authMember!;
      const userId = String(req.params.userId);
      const parsed = userUpdateSchema.safeParse(req.body);
      if (!parsed.success) {
        throw new ServiceError(400, parsed.error.issues[0]?.message || 'Invalid user update');
      }
      const patch = parsed.data;

      const updated = await repository.mutate((draft) => {
        const target = draft.users.find((u) => u.userId === userId);
        if (!target) throw new ServiceError(404, 'User not found.');

        if (actor.role !== 'SUPER_ADMIN') {
          if (target.role !== 'MEMBER') {
            throw new ServiceError(
              403,
              'Only a Super Admin can modify Admin or Super Admin accounts.'
            );
          }
          if (patch.role && patch.role !== target.role) {
            throw new ServiceError(
              403,
              'Admins cannot assign or change global user roles.'
            );
          }
          if (target.userId === actor.userId) {
            throw new ServiceError(403, 'Admins cannot modify their own global account.');
          }
        }

        // Prevent demoting/deactivating last active SUPER_ADMIN
        const activeSuperAdmins = draft.users.filter(
          (u) => u.role === 'SUPER_ADMIN' && u.status === 'Active'
        );
        if (
          target.role === 'SUPER_ADMIN' &&
          target.status === 'Active' &&
          activeSuperAdmins.length <= 1 &&
          ((patch.role && patch.role !== 'SUPER_ADMIN') || patch.status === 'Inactive')
        ) {
          throw new ServiceError(400, 'Cannot demote or deactivate the last active Super Admin.');
        }

        const prev = structuredClone(target);
        if (patch.name !== undefined) target.name = patch.name;
        if (patch.role !== undefined) target.role = patch.role;
        if (patch.status !== undefined) target.status = patch.status;
        target.updatedAt = new Date().toISOString();

        const action =
          prev.role !== target.role
            ? 'USER_ROLE_CHANGED'
            : prev.status !== target.status
            ? target.status === 'Active'
              ? 'USER_ACTIVATED'
              : 'USER_DEACTIVATED'
            : 'USER_UPDATED';

        appendAudit(draft, {
          actorId: actor.userId,
          actorEmail: actor.email,
          actorRole: actor.role,
          action,
          entityType: 'User',
          entityId: userId,
          previousValue: prev,
          newValue: structuredClone(target),
        });
        return target;
      });
      res.json(updated);
    } catch (err) {
      next(err);
    }
  });

  // =========================================================================
  // GLOBAL WORK FIELD CONFIGURATION (SUPER ADMIN ONLY)
  // =========================================================================
  app.post('/api/work-config/fields', requireAuth, requireSuperAdmin, async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const admin = req.authMember!;
      const parsed = fieldCreateSchema.safeParse(req.body);
      if (!parsed.success) {
        throw new ServiceError(400, parsed.error.issues[0]?.message || 'Invalid field definition');
      }
      const input = parsed.data;

      const created = await repository.mutate((draft) => {
        const nowIso = new Date().toISOString();
        const fieldId = `fld_${Date.now().toString(36)}`;
        const maxOrder = draft.workFieldDefinitions.reduce(
          (m, f) => Math.max(m, f.displayOrder),
          0
        );

        const field: WorkFieldDefinition = {
          fieldId,
          label: input.label,
          fieldType: input.fieldType,
          systemRole: 'custom',
          required: input.required,
          placeholder: input.placeholder || '',
          helpText: input.helpText || '',
          validation: input.validation,
          displayOrder: maxOrder + 1,
          active: true,
          archived: false,
          defaultValue: input.defaultValue,
          createdAt: nowIso,
          updatedAt: nowIso,
        };
        draft.workFieldDefinitions.push(field);

        if (
          ['dropdown', 'multi_select', 'radio'].includes(input.fieldType) &&
          input.options
        ) {
          input.options.forEach((opt, idx) => {
            draft.workFieldOptions.push({
              optionId: `opt_${Date.now().toString(36)}_${idx}`,
              fieldId,
              label: opt.label,
              value: opt.label,
              semanticStatus: opt.semanticStatus,
              displayOrder: idx + 1,
              active: true,
              createdAt: nowIso,
              updatedAt: nowIso,
            });
          });
        }

        const version = snapshotGlobalConfigVersion(draft, admin.email);
        appendAudit(draft, {
          actorId: admin.userId,
          actorEmail: admin.email,
          actorRole: admin.role,
          action: 'WORK_FIELD_CREATED',
          entityType: 'WorkFieldConfig',
          entityId: fieldId,
          newValue: { field, configVersion: version.version },
        });
        return { field, configVersion: version.version };
      });
      res.status(201).json(created);
    } catch (err) {
      next(err);
    }
  });

  app.patch('/api/work-config/fields/:fieldId', requireAuth, requireSuperAdmin, async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const admin = req.authMember!;
      const fieldId = String(req.params.fieldId);
      const parsed = fieldUpdateSchema.safeParse(req.body);
      if (!parsed.success) {
        throw new ServiceError(400, parsed.error.issues[0]?.message || 'Invalid field update');
      }
      const patch = parsed.data;

      const updated = await repository.mutate((draft) => {
        const field = draft.workFieldDefinitions.find((f) => f.fieldId === fieldId);
        if (!field) throw new ServiceError(404, 'Field definition not found.');

        const prev = structuredClone(field);
        if (patch.label !== undefined) field.label = patch.label;
        if (patch.required !== undefined) field.required = patch.required;
        if (patch.placeholder !== undefined) field.placeholder = patch.placeholder;
        if (patch.helpText !== undefined) field.helpText = patch.helpText;
        if (patch.displayOrder !== undefined) field.displayOrder = patch.displayOrder;
        if (patch.active !== undefined) field.active = patch.active;
        if (patch.archived !== undefined) {
          field.archived = patch.archived;
          if (patch.archived) field.active = false;
        }
        if (patch.defaultValue !== undefined) {
          field.defaultValue = patch.defaultValue === null ? undefined : patch.defaultValue;
        }
        if (patch.validation !== undefined) field.validation = patch.validation;
        field.updatedAt = new Date().toISOString();

        const version = snapshotGlobalConfigVersion(draft, admin.email);
        appendAudit(draft, {
          actorId: admin.userId,
          actorEmail: admin.email,
          actorRole: admin.role,
          action: 'WORK_FIELD_UPDATED',
          entityType: 'WorkFieldConfig',
          entityId: fieldId,
          previousValue: prev,
          newValue: { field: structuredClone(field), configVersion: version.version },
        });
        return { field, configVersion: version.version };
      });
      res.json(updated);
    } catch (err) {
      next(err);
    }
  });

  app.post('/api/work-config/fields/reorder', requireAuth, requireSuperAdmin, async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const admin = req.authMember!;
      const orderedIds = Array.isArray(req.body?.orderedIds)
        ? (req.body.orderedIds as string[])
        : null;
      if (!orderedIds || orderedIds.length === 0) {
        throw new ServiceError(400, 'orderedIds array is required.');
      }

      const result = await repository.mutate((draft) => {
        const nowIso = new Date().toISOString();
        orderedIds.forEach((id, idx) => {
          const f = draft.workFieldDefinitions.find((item) => item.fieldId === id);
          if (f) {
            f.displayOrder = idx + 1;
            f.updatedAt = nowIso;
          }
        });
        const version = snapshotGlobalConfigVersion(draft, admin.email);
        appendAudit(draft, {
          actorId: admin.userId,
          actorEmail: admin.email,
          actorRole: admin.role,
          action: 'WORK_FIELDS_REORDERED',
          entityType: 'WorkFieldConfig',
          entityId: `v${version.version}`,
          newValue: orderedIds,
        });
        return { configVersion: version.version };
      });
      res.json(result);
    } catch (err) {
      next(err);
    }
  });

  app.post('/api/work-config/options', requireAuth, requireSuperAdmin, async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const admin = req.authMember!;
      const parsed = fieldOptionCreateSchema.safeParse(req.body);
      if (!parsed.success) {
        throw new ServiceError(400, parsed.error.issues[0]?.message || 'Invalid option payload');
      }
      const input = parsed.data;

      const result = await repository.mutate((draft) => {
        const field = draft.workFieldDefinitions.find(
          (f) => f.fieldId === input.fieldId
        );
        if (!field) throw new ServiceError(404, 'Target field not found.');
        if (field.systemRole === 'status' && !input.semanticStatus) {
          throw new ServiceError(
            400,
            'Work Status options must specify a semantic meaning (completed, in_progress, or blocked).'
          );
        }

        const nowIso = new Date().toISOString();
        const maxOrder = draft.workFieldOptions
          .filter((o) => o.fieldId === input.fieldId)
          .reduce((m, o) => Math.max(m, o.displayOrder), 0);

        const opt: WorkFieldOption = {
          optionId: `opt_${Date.now().toString(36)}`,
          fieldId: input.fieldId,
          label: input.label,
          value: input.label,
          semanticStatus: input.semanticStatus,
          displayOrder: maxOrder + 1,
          active: true,
          createdAt: nowIso,
          updatedAt: nowIso,
        };
        draft.workFieldOptions.push(opt);

        const version = snapshotGlobalConfigVersion(draft, admin.email);
        appendAudit(draft, {
          actorId: admin.userId,
          actorEmail: admin.email,
          actorRole: admin.role,
          action: 'WORK_FIELD_OPTION_ADDED',
          entityType: 'WorkFieldConfig',
          entityId: opt.optionId,
          newValue: { option: opt, configVersion: version.version },
        });
        return { option: opt, configVersion: version.version };
      });
      res.status(201).json(result);
    } catch (err) {
      next(err);
    }
  });

  app.patch('/api/work-config/options/:optionId', requireAuth, requireSuperAdmin, async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const admin = req.authMember!;
      const optionId = String(req.params.optionId);
      const parsed = fieldOptionUpdateSchema.safeParse(req.body);
      if (!parsed.success) {
        throw new ServiceError(400, parsed.error.issues[0]?.message || 'Invalid option update');
      }
      const patch = parsed.data;

      const result = await repository.mutate((draft) => {
        const opt = draft.workFieldOptions.find((o) => o.optionId === optionId);
        if (!opt) throw new ServiceError(404, 'Option not found.');
        const prev = structuredClone(opt);
        if (patch.label !== undefined) {
          opt.label = patch.label;
          opt.value = patch.label;
        }
        if (patch.semanticStatus !== undefined) {
          opt.semanticStatus = patch.semanticStatus;
        }
        if (patch.displayOrder !== undefined) {
          opt.displayOrder = patch.displayOrder;
        }
        if (patch.active !== undefined) {
          opt.active = patch.active;
        }
        opt.updatedAt = new Date().toISOString();

        const version = snapshotGlobalConfigVersion(draft, admin.email);
        appendAudit(draft, {
          actorId: admin.userId,
          actorEmail: admin.email,
          actorRole: admin.role,
          action: 'WORK_FIELD_OPTION_UPDATED',
          entityType: 'WorkFieldConfig',
          entityId: optionId,
          previousValue: prev,
          newValue: { option: structuredClone(opt), configVersion: version.version },
        });
        return { option: opt, configVersion: version.version };
      });
      res.json(result);
    } catch (err) {
      next(err);
    }
  });

  // =========================================================================
  // PROJECT-SPECIFIC WORK CONFIGURATION (Isolated per project, Project Admin)
  // =========================================================================
  app.post('/api/projects/:projectId/config/mode', requireAuth, requireAdminOrSuperAdmin, async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const actor = req.authMember!;
      const projectId = String(req.params.projectId);
      const useProjectConfig = Boolean(req.body?.useProjectConfig);

      const result = await repository.mutate((draft) => {
        const project = draft.projects.find((p) => p.projectId === projectId);
        if (!project) throw new ServiceError(404, 'Project not found.');
        if (!canManageProject(draft, actor, projectId)) {
          throw new ServiceError(403, 'Not authorized to configure this project.');
        }
        const prev = project.useProjectConfig;
        project.useProjectConfig = useProjectConfig;
        project.updatedAt = new Date().toISOString();

        // Ensure project has at least one version snapshot when enabling project override
        const hasVersion = draft.projectConfigurationVersions.some(
          (v) => v.projectId === projectId
        );
        if (useProjectConfig && !hasVersion) {
          snapshotProjectConfigVersion(
            draft,
            projectId,
            draft.workFieldDefinitions,
            draft.workFieldOptions,
            actor.email
          );
        }

        appendAudit(draft, {
          actorId: actor.userId,
          actorEmail: actor.email,
          actorRole: actor.role,
          action: 'PROJECT_CONFIG_MODE_CHANGED',
          entityType: 'ProjectConfig',
          entityId: projectId,
          projectId,
          previousValue: { useProjectConfig: prev },
          newValue: { useProjectConfig },
        });

        return getEffectiveProjectConfig(draft, projectId);
      });

      res.json(result);
    } catch (err) {
      next(err);
    }
  });

  app.post('/api/projects/:projectId/config/fields', requireAuth, requireAdminOrSuperAdmin, async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const actor = req.authMember!;
      const projectId = String(req.params.projectId);
      const parsed = fieldCreateSchema.safeParse(req.body);
      if (!parsed.success) {
        throw new ServiceError(400, parsed.error.issues[0]?.message || 'Invalid field definition');
      }
      const input = parsed.data;

      const created = await repository.mutate((draft) => {
        if (!canManageProject(draft, actor, projectId)) {
          throw new ServiceError(403, 'Not authorized to configure fields for this project.');
        }
        const currentCfg = getEffectiveProjectConfig(draft, projectId);
        const fields = structuredClone(currentCfg.fields);
        const options = structuredClone(currentCfg.options);

        const nowIso = new Date().toISOString();
        const fieldId = `pfld_${Date.now().toString(36)}`;
        const maxOrder = fields.reduce((m, f) => Math.max(m, f.displayOrder), 0);

        const field: WorkFieldDefinition = {
          fieldId,
          label: input.label,
          fieldType: input.fieldType,
          systemRole: 'custom',
          required: input.required,
          placeholder: input.placeholder || '',
          helpText: input.helpText || '',
          validation: input.validation,
          displayOrder: maxOrder + 1,
          active: true,
          archived: false,
          defaultValue: input.defaultValue,
          createdAt: nowIso,
          updatedAt: nowIso,
        };
        fields.push(field);

        if (
          ['dropdown', 'multi_select', 'radio'].includes(input.fieldType) &&
          input.options
        ) {
          input.options.forEach((opt, idx) => {
            options.push({
              optionId: `popt_${Date.now().toString(36)}_${idx}`,
              fieldId,
              label: opt.label,
              value: opt.label,
              semanticStatus: opt.semanticStatus,
              displayOrder: idx + 1,
              active: true,
              createdAt: nowIso,
              updatedAt: nowIso,
            });
          });
        }

        const version = snapshotProjectConfigVersion(
          draft,
          projectId,
          fields,
          options,
          actor.email
        );

        appendAudit(draft, {
          actorId: actor.userId,
          actorEmail: actor.email,
          actorRole: actor.role,
          action: 'PROJECT_FIELD_CREATED',
          entityType: 'ProjectConfig',
          entityId: fieldId,
          projectId,
          newValue: { field, version: version.version },
        });
        return { field, version: version.version };
      });
      res.status(201).json(created);
    } catch (err) {
      next(err);
    }
  });

  app.patch('/api/projects/:projectId/config/fields/:fieldId', requireAuth, requireAdminOrSuperAdmin, async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const actor = req.authMember!;
      const projectId = String(req.params.projectId);
      const fieldId = String(req.params.fieldId);
      const parsed = fieldUpdateSchema.safeParse(req.body);
      if (!parsed.success) {
        throw new ServiceError(400, parsed.error.issues[0]?.message || 'Invalid field update');
      }
      const patch = parsed.data;

      const updated = await repository.mutate((draft) => {
        if (!canManageProject(draft, actor, projectId)) {
          throw new ServiceError(403, 'Not authorized to configure fields for this project.');
        }
        const currentCfg = getEffectiveProjectConfig(draft, projectId);
        const fields = structuredClone(currentCfg.fields);
        const options = structuredClone(currentCfg.options);

        const field = fields.find((f) => f.fieldId === fieldId);
        if (!field) throw new ServiceError(404, 'Field not found in project configuration.');

        const prev = structuredClone(field);
        if (patch.label !== undefined) field.label = patch.label;
        if (patch.required !== undefined) field.required = patch.required;
        if (patch.placeholder !== undefined) field.placeholder = patch.placeholder;
        if (patch.helpText !== undefined) field.helpText = patch.helpText;
        if (patch.displayOrder !== undefined) field.displayOrder = patch.displayOrder;
        if (patch.active !== undefined) field.active = patch.active;
        if (patch.archived !== undefined) {
          field.archived = patch.archived;
          if (patch.archived) field.active = false;
        }
        if (patch.defaultValue !== undefined) {
          field.defaultValue = patch.defaultValue === null ? undefined : patch.defaultValue;
        }
        if (patch.validation !== undefined) field.validation = patch.validation;
        field.updatedAt = new Date().toISOString();

        const version = snapshotProjectConfigVersion(
          draft,
          projectId,
          fields,
          options,
          actor.email
        );

        appendAudit(draft, {
          actorId: actor.userId,
          actorEmail: actor.email,
          actorRole: actor.role,
          action: 'PROJECT_FIELD_UPDATED',
          entityType: 'ProjectConfig',
          entityId: fieldId,
          projectId,
          previousValue: prev,
          newValue: { field, version: version.version },
        });
        return { field, version: version.version };
      });
      res.json(updated);
    } catch (err) {
      next(err);
    }
  });

  app.post('/api/projects/:projectId/config/fields/reorder', requireAuth, requireAdminOrSuperAdmin, async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const actor = req.authMember!;
      const projectId = String(req.params.projectId);
      const orderedIds = Array.isArray(req.body?.orderedIds)
        ? (req.body.orderedIds as string[])
        : null;
      if (!orderedIds || orderedIds.length === 0) {
        throw new ServiceError(400, 'orderedIds array is required.');
      }

      const result = await repository.mutate((draft) => {
        if (!canManageProject(draft, actor, projectId)) {
          throw new ServiceError(403, 'Not authorized to reorder fields for this project.');
        }
        const currentCfg = getEffectiveProjectConfig(draft, projectId);
        const fields = structuredClone(currentCfg.fields);
        const options = structuredClone(currentCfg.options);
        const nowIso = new Date().toISOString();

        orderedIds.forEach((id, idx) => {
          const f = fields.find((item) => item.fieldId === id);
          if (f) {
            f.displayOrder = idx + 1;
            f.updatedAt = nowIso;
          }
        });

        const version = snapshotProjectConfigVersion(
          draft,
          projectId,
          fields,
          options,
          actor.email
        );
        appendAudit(draft, {
          actorId: actor.userId,
          actorEmail: actor.email,
          actorRole: actor.role,
          action: 'PROJECT_FIELDS_REORDERED',
          entityType: 'ProjectConfig',
          entityId: projectId,
          projectId,
          newValue: { orderedIds, version: version.version },
        });
        return { version: version.version };
      });
      res.json(result);
    } catch (err) {
      next(err);
    }
  });

  app.post('/api/projects/:projectId/config/options', requireAuth, requireAdminOrSuperAdmin, async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const actor = req.authMember!;
      const projectId = String(req.params.projectId);
      const parsed = fieldOptionCreateSchema.safeParse(req.body);
      if (!parsed.success) {
        throw new ServiceError(400, parsed.error.issues[0]?.message || 'Invalid option payload');
      }
      const input = parsed.data;

      const result = await repository.mutate((draft) => {
        if (!canManageProject(draft, actor, projectId)) {
          throw new ServiceError(403, 'Not authorized to configure options for this project.');
        }
        const currentCfg = getEffectiveProjectConfig(draft, projectId);
        const fields = structuredClone(currentCfg.fields);
        const options = structuredClone(currentCfg.options);

        const field = fields.find((f) => f.fieldId === input.fieldId);
        if (!field) throw new ServiceError(404, 'Target field not found in project config.');
        if (field.systemRole === 'status' && !input.semanticStatus) {
          throw new ServiceError(400, 'Work Status options require a semantic status.');
        }

        const nowIso = new Date().toISOString();
        const maxOrder = options
          .filter((o) => o.fieldId === input.fieldId)
          .reduce((m, o) => Math.max(m, o.displayOrder), 0);

        const opt: WorkFieldOption = {
          optionId: `popt_${Date.now().toString(36)}`,
          fieldId: input.fieldId,
          label: input.label,
          value: input.label,
          semanticStatus: input.semanticStatus,
          displayOrder: maxOrder + 1,
          active: true,
          createdAt: nowIso,
          updatedAt: nowIso,
        };
        options.push(opt);

        const version = snapshotProjectConfigVersion(
          draft,
          projectId,
          fields,
          options,
          actor.email
        );
        appendAudit(draft, {
          actorId: actor.userId,
          actorEmail: actor.email,
          actorRole: actor.role,
          action: 'PROJECT_OPTION_ADDED',
          entityType: 'ProjectConfig',
          entityId: opt.optionId,
          projectId,
          newValue: { option: opt, version: version.version },
        });
        return { option: opt, version: version.version };
      });
      res.status(201).json(result);
    } catch (err) {
      next(err);
    }
  });

  app.patch('/api/projects/:projectId/config/options/:optionId', requireAuth, requireAdminOrSuperAdmin, async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const actor = req.authMember!;
      const projectId = String(req.params.projectId);
      const optionId = String(req.params.optionId);
      const parsed = fieldOptionUpdateSchema.safeParse(req.body);
      if (!parsed.success) {
        throw new ServiceError(400, parsed.error.issues[0]?.message || 'Invalid option update');
      }
      const patch = parsed.data;

      const result = await repository.mutate((draft) => {
        if (!canManageProject(draft, actor, projectId)) {
          throw new ServiceError(403, 'Not authorized to configure options for this project.');
        }
        const currentCfg = getEffectiveProjectConfig(draft, projectId);
        const fields = structuredClone(currentCfg.fields);
        const options = structuredClone(currentCfg.options);

        const opt = options.find((o) => o.optionId === optionId);
        if (!opt) throw new ServiceError(404, 'Option not found in project configuration.');

        const prev = structuredClone(opt);
        if (patch.label !== undefined) {
          opt.label = patch.label;
          opt.value = patch.label;
        }
        if (patch.semanticStatus !== undefined) opt.semanticStatus = patch.semanticStatus;
        if (patch.displayOrder !== undefined) opt.displayOrder = patch.displayOrder;
        if (patch.active !== undefined) opt.active = patch.active;
        opt.updatedAt = new Date().toISOString();

        const version = snapshotProjectConfigVersion(
          draft,
          projectId,
          fields,
          options,
          actor.email
        );
        appendAudit(draft, {
          actorId: actor.userId,
          actorEmail: actor.email,
          actorRole: actor.role,
          action: 'PROJECT_OPTION_UPDATED',
          entityType: 'ProjectConfig',
          entityId: optionId,
          projectId,
          previousValue: prev,
          newValue: { option: opt, version: version.version },
        });
        return { option: opt, version: version.version };
      });
      res.json(result);
    } catch (err) {
      next(err);
    }
  });

  // =========================================================================
  // WEEKLY SUMMARY GENERATOR (Project & Role Scoped)
  // =========================================================================
  app.post('/api/reports/weekly-summary', requireAuth, requireAdminOrSuperAdmin, async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const actor = req.authMember!;
      const weekStart = String(req.body?.weekStart || '');
      const weekEnd = String(req.body?.weekEnd || '');
      const projectId =
        typeof req.body?.projectId === 'string' && req.body.projectId.trim()
          ? req.body.projectId.trim()
          : undefined;

      if (!dateRegex.test(weekStart) || !dateRegex.test(weekEnd) || weekEnd < weekStart) {
        throw new ServiceError(400, 'Valid reporting week start and end dates are required.');
      }

      const store = await repository.read();
      const summary = generateWeeklyTeamUpdate(
        store,
        actor,
        weekStart,
        weekEnd,
        projectId
      );

      await repository.mutate((draft) => {
        appendAudit(draft, {
          actorId: actor.userId,
          actorEmail: actor.email,
          actorRole: actor.role,
          action: 'WEEKLY_SUMMARY_GENERATED',
          entityType: 'WeeklySummary',
          entityId: `${weekStart}_to_${weekEnd}`,
          projectId,
          newValue: {
            completedCount: summary.completedCount,
            inProgressCount: summary.inProgressCount,
          },
        });
      });

      res.json(summary);
    } catch (err) {
      next(err);
    }
  });

  // =========================================================================
  // SYSTEM SETTINGS & GOOGLE SHEETS (SUPER ADMIN ONLY)
  // =========================================================================
  app.patch('/api/settings', requireAuth, requireSuperAdmin, async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const admin = req.authMember!;
      const parsed = settingsUpdateSchema.safeParse(req.body);
      if (!parsed.success) {
        throw new ServiceError(400, parsed.error.issues[0]?.message || 'Invalid settings payload');
      }
      const patch = parsed.data;

      const updated = await repository.mutate((draft) => {
        const prev = structuredClone(draft.systemSettings);
        draft.systemSettings = {
          ...draft.systemSettings,
          ...patch,
        };
        const action =
          prev.timezone !== draft.systemSettings.timezone
            ? 'TIMEZONE_UPDATED'
            : 'SYSTEM_SETTINGS_UPDATED';

        appendAudit(draft, {
          actorId: admin.userId,
          actorEmail: admin.email,
          actorRole: admin.role,
          action,
          entityType: 'SystemSettings',
          entityId: 'GLOBAL',
          previousValue: prev,
          newValue: structuredClone(draft.systemSettings),
        });
        return draft.systemSettings;
      });
      res.json(updated);
    } catch (err) {
      next(err);
    }
  });

  app.post('/api/sheets/create', requireAuth, requireSuperAdmin, async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const admin = req.authMember!;
      const accessToken = req.googleAccessToken;
      if (!accessToken) {
        throw new ServiceError(
          401,
          'Google Workspace authorization token missing. Re-authorize your Google session to create the spreadsheet.'
        );
      }

      const store = await repository.read();
      const title =
        typeof req.body?.title === 'string' && req.body.title.trim()
          ? req.body.title.trim()
          : `${store.systemSettings.companyName} — DayFlow Store`;

      const { spreadsheetId, spreadsheetUrl } = await createDayFlowSpreadsheet(
        accessToken,
        title
      );
      const syncRes = await syncStoreToGoogleSheet(accessToken, spreadsheetId, store);

      const settings = await repository.mutate((draft) => {
        draft.systemSettings.linkedSpreadsheetId = spreadsheetId;
        draft.systemSettings.linkedSpreadsheetUrl = spreadsheetUrl;
        draft.systemSettings.lastSheetsSyncAt = new Date().toISOString();
        appendAudit(draft, {
          actorId: admin.userId,
          actorEmail: admin.email,
          actorRole: admin.role,
          action: 'GOOGLE_SHEET_CREATED',
          entityType: 'SheetsSync',
          entityId: spreadsheetId,
          newValue: { spreadsheetId, updatedCells: syncRes.updatedCells },
        });
        return draft.systemSettings;
      });

      res.json({
        spreadsheetId,
        spreadsheetUrl,
        updatedCells: syncRes.updatedCells,
        systemSettings: settings,
      });
    } catch (err) {
      next(err);
    }
  });

  app.post('/api/sheets/link', requireAuth, requireSuperAdmin, async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const admin = req.authMember!;
      const accessToken = req.googleAccessToken;
      if (!accessToken) {
        throw new ServiceError(401, 'Google Workspace access token missing.');
      }
      const spreadsheetId = String(req.body?.spreadsheetId || '').trim();
      if (!spreadsheetId) {
        throw new ServiceError(400, 'Spreadsheet ID is required.');
      }
      const meta = await getSpreadsheetMetadata(accessToken, spreadsheetId);
      const settings = await repository.mutate((draft) => {
        draft.systemSettings.linkedSpreadsheetId = spreadsheetId;
        draft.systemSettings.linkedSpreadsheetUrl = meta.spreadsheetUrl;
        appendAudit(draft, {
          actorId: admin.userId,
          actorEmail: admin.email,
          actorRole: admin.role,
          action: 'GOOGLE_SHEET_LINKED',
          entityType: 'SheetsSync',
          entityId: spreadsheetId,
          newValue: { title: meta.title, sheetTitles: meta.sheetTitles },
        });
        return draft.systemSettings;
      });
      res.json({ meta, systemSettings: settings });
    } catch (err) {
      next(err);
    }
  });

  app.post('/api/sheets/sync', requireAuth, requireSuperAdmin, async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const admin = req.authMember!;
      const accessToken = req.googleAccessToken;
      if (!accessToken) {
        throw new ServiceError(401, 'Google Workspace access token missing.');
      }
      const store = await repository.read();
      const spreadsheetId = store.systemSettings.linkedSpreadsheetId;
      if (!spreadsheetId) {
        throw new ServiceError(400, 'No Google Sheet is linked yet.');
      }
      const syncRes = await syncStoreToGoogleSheet(accessToken, spreadsheetId, store);
      const settings = await repository.mutate((draft) => {
        draft.systemSettings.lastSheetsSyncAt = new Date().toISOString();
        appendAudit(draft, {
          actorId: admin.userId,
          actorEmail: admin.email,
          actorRole: admin.role,
          action: 'GOOGLE_SHEET_SYNCED',
          entityType: 'SheetsSync',
          entityId: spreadsheetId,
          newValue: { updatedCells: syncRes.updatedCells },
        });
        return draft.systemSettings;
      });
      res.json({ ...syncRes, systemSettings: settings });
    } catch (err) {
      next(err);
    }
  });

  app.use('/api', (err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    if (err instanceof ServiceError) {
      res.status(err.status).json({ error: err.message });
      return;
    }
    console.error('Unhandled API error:', err);
    res.status(500).json({
      error: err instanceof Error ? err.message : 'Internal server error',
    });
  });

  const httpServer = http.createServer(app);

  if (!IS_PROD) {
    const vite = await createViteServer({
      server: {
        middlewareMode: true,
        ws: { server: httpServer },
      },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distDir = path.resolve(process.cwd(), 'dist');
    app.use(express.static(distDir));
    app.get('*', (_req, res) => {
      const indexPath = path.join(distDir, 'index.html');
      if (fs.existsSync(indexPath)) {
        res.sendFile(indexPath);
      } else {
        res.status(404).send('Build output not found.');
      }
    });
  }

  httpServer.listen(PORT, '0.0.0.0', () => {
    console.log(`DayFlow server listening on http://0.0.0.0:${PORT}`);
  });
}

startServer().catch((err) => {
  console.error('Fatal server startup error:', err);
  process.exit(1);
});
