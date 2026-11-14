import { Prisma, AuditLog } from '@prisma/client';
import prisma from '../../config/database';
import { CreateAuditLogDto, AuditLogFilter } from './types';
import { ForbiddenError, NotFoundError } from '../../utils/errors';

export class AuditService {
  /**
   * Appends an immutable audit log entry.
   */
  async logAction(
    dto: CreateAuditLogDto,
    tx?: Prisma.TransactionClient
  ): Promise<AuditLog> {
    const client = tx ?? prisma;

    return client.auditLog.create({
      data: {
        userId: dto.userId ?? null,
        action: dto.action,
        entityType: dto.entityType,
        entityId: dto.entityId,
        before: (dto.before as Prisma.InputJsonValue) ?? Prisma.JsonNull,
        after: (dto.after as Prisma.InputJsonValue) ?? Prisma.JsonNull,
        ipAddress: dto.ipAddress ?? null,
        userAgent: dto.userAgent ?? null,
      },
    });
  }

  /**
   * Retrieves audit logs with optional filtering.
   */
  async getAuditLogs(filter: AuditLogFilter = {}): Promise<AuditLog[]> {
    const where: Prisma.AuditLogWhereInput = {};

    if (filter.entityType) where.entityType = filter.entityType;
    if (filter.entityId) where.entityId = filter.entityId;
    if (filter.userId) where.userId = filter.userId;
    if (filter.action) where.action = filter.action;
    if (filter.startDate || filter.endDate) {
      where.createdAt = {};
      if (filter.startDate) where.createdAt.gte = filter.startDate;
      if (filter.endDate) where.createdAt.lte = filter.endDate;
    }

    return prisma.auditLog.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: filter.limit ?? 100,
      skip: filter.offset ?? 0,
      include: {
        user: {
          select: {
            id: true,
            email: true,
            name: true,
            role: true,
          },
        },
      },
    });
  }

  /**
   * Retrieves a single audit log entry by ID.
   */
  async getAuditLogById(id: string): Promise<AuditLog> {
    const log = await prisma.auditLog.findUnique({
      where: { id },
      include: {
        user: {
          select: {
            id: true,
            email: true,
            name: true,
            role: true,
          },
        },
      },
    });

    if (!log) {
      throw new NotFoundError(`Audit log with ID '${id}' not found`);
    }

    return log;
  }

  /**
   * Enforces append-only constraint: forbids updates.
   */
  updateAuditLog(): never {
    throw new ForbiddenError('Audit log entries are immutable and cannot be updated');
  }

  /**
   * Enforces append-only constraint: forbids deletes.
   */
  deleteAuditLog(): never {
    throw new ForbiddenError('Audit log entries are immutable and cannot be deleted');
  }
}

export const auditService = new AuditService();
