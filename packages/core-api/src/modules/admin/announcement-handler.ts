/**
 * Announcement route handlers — request/response layer for global announcements.
 *
 * Allows admins to create, update, activate, deactivate, and delete
 * platform-wide announcements (banners / notifications).
 */

import type { FastifyReply, FastifyRequest } from 'fastify';
import type {
  AnnouncementService,
  CreateAnnouncementInput,
  UpdateAnnouncementInput,
} from './announcement-service';
import { AnnouncementNotFoundError } from './announcement-service';

// ---------------------------------------------------------------------------
// Admin context helper
// ---------------------------------------------------------------------------

interface AdminContext {
  adminUserId: string;
  adminUserEmail: string;
}

function extractAdminContext(request: FastifyRequest): AdminContext {
  const adminUserId = request.headers['x-admin-user-id'] as string ?? '';
  const adminUserEmail = request.headers['x-admin-user-email'] as string ?? '';
  return { adminUserId, adminUserEmail };
}

// ---------------------------------------------------------------------------
// Handler factory
// ---------------------------------------------------------------------------

export function createAnnouncementHandlers(service: AnnouncementService) {
  return {
    listAnnouncements,
    createAnnouncement,
    getAnnouncement,
    updateAnnouncement,
    deleteAnnouncement,
    activateAnnouncement,
    deactivateAnnouncement,
    getActiveAnnouncements,
  };

  // --- List all announcements ---

  async function listAnnouncements(
    _request: FastifyRequest,
    reply: FastifyReply,
  ) {
    const items = await service.listAnnouncements();
    return reply.send({ items, total: items.length });
  }

  // --- Create announcement ---

  async function createAnnouncement(
    request: FastifyRequest<{ Body: CreateAnnouncementInput }>,
    reply: FastifyReply,
  ) {
    const { adminUserId, adminUserEmail } = extractAdminContext(request);
    const announcement = await service.createAnnouncement(
      request.body,
      adminUserId,
      adminUserEmail,
    );
    return reply.status(201).send(announcement);
  }

  // --- Get single announcement ---

  async function getAnnouncement(
    request: FastifyRequest<{ Params: { id: string } }>,
    reply: FastifyReply,
  ) {
    try {
      const announcement = await service.getAnnouncement(request.params.id);
      return reply.send(announcement);
    } catch (err) {
      if (err instanceof AnnouncementNotFoundError) {
        return reply.status(404).send({ error: 'NOT_FOUND', message: err.message });
      }
      throw err;
    }
  }

  // --- Update announcement ---

  async function updateAnnouncement(
    request: FastifyRequest<{ Params: { id: string }; Body: UpdateAnnouncementInput }>,
    reply: FastifyReply,
  ) {
    const { adminUserId, adminUserEmail } = extractAdminContext(request);

    try {
      const announcement = await service.updateAnnouncement(
        request.params.id,
        request.body,
        adminUserId,
        adminUserEmail,
      );
      return reply.send(announcement);
    } catch (err) {
      if (err instanceof AnnouncementNotFoundError) {
        return reply.status(404).send({ error: 'NOT_FOUND', message: err.message });
      }
      throw err;
    }
  }

  // --- Delete announcement ---

  async function deleteAnnouncement(
    request: FastifyRequest<{ Params: { id: string } }>,
    reply: FastifyReply,
  ) {
    const { adminUserId, adminUserEmail } = extractAdminContext(request);

    try {
      await service.deleteAnnouncement(
        request.params.id,
        adminUserId,
        adminUserEmail,
      );
      return reply.send({ success: true });
    } catch (err) {
      if (err instanceof AnnouncementNotFoundError) {
        return reply.status(404).send({ error: 'NOT_FOUND', message: err.message });
      }
      throw err;
    }
  }

  // --- Activate announcement ---

  async function activateAnnouncement(
    request: FastifyRequest<{ Params: { id: string } }>,
    reply: FastifyReply,
  ) {
    const { adminUserId, adminUserEmail } = extractAdminContext(request);

    try {
      const announcement = await service.activateAnnouncement(
        request.params.id,
        adminUserId,
        adminUserEmail,
      );
      return reply.send(announcement);
    } catch (err) {
      if (err instanceof AnnouncementNotFoundError) {
        return reply.status(404).send({ error: 'NOT_FOUND', message: err.message });
      }
      throw err;
    }
  }

  // --- Deactivate announcement ---

  async function deactivateAnnouncement(
    request: FastifyRequest<{ Params: { id: string } }>,
    reply: FastifyReply,
  ) {
    const { adminUserId, adminUserEmail } = extractAdminContext(request);

    try {
      const announcement = await service.deactivateAnnouncement(
        request.params.id,
        adminUserId,
        adminUserEmail,
      );
      return reply.send(announcement);
    } catch (err) {
      if (err instanceof AnnouncementNotFoundError) {
        return reply.status(404).send({ error: 'NOT_FOUND', message: err.message });
      }
      throw err;
    }
  }

  // --- Get active announcements ---

  async function getActiveAnnouncements(
    _request: FastifyRequest,
    reply: FastifyReply,
  ) {
    const items = await service.getActiveAnnouncements();
    return reply.send({ items, total: items.length });
  }
}
