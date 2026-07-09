import { Injectable } from '@nestjs/common';

import {
  Prisma,
  TicketCategory,
  TicketPriority,
  TicketStatus,
} from '@prisma/client';

import { PrismaService } from '../../../infrastructure/database/prisma.service';

export const TICKET_MESSAGE_INCLUDE = {
  attachments: true,
} as const;

export const TICKET_DETAIL_INCLUDE = {
  messages: {
    orderBy: { createdAt: 'asc' as const },
    include: TICKET_MESSAGE_INCLUDE,
  },
} as const;

export const TICKET_ADMIN_INCLUDE = {
  customer: {
    select: {
      id: true,
      firstName: true,
      lastName: true,
      email: true,
      phone: true,
    },
  },
} as const;

export interface AdminTicketFilterParams {
  search?: string;
  status?: TicketStatus;
  category?: TicketCategory;
  priority?: TicketPriority;
  assignedAgentId?: string;
  unassigned?: boolean;
}

@Injectable()
export class TicketsRepository {
  constructor(private readonly prisma: PrismaService) {}

  async createTicket(data: {
    ticketNumber: string;
    customerId: string;
    category: string;
    priority: TicketPriority;
    subject: string;
    description: string;
    orderId?: string;
    paymentId?: string;
  }) {
    return this.prisma.supportTicket.create({
      data: data as Prisma.SupportTicketUncheckedCreateInput,
      include: TICKET_DETAIL_INCLUDE,
    });
  }

  async findTicketById(id: string) {
    return this.prisma.supportTicket.findUnique({
      where: { id },
      include: TICKET_DETAIL_INCLUDE,
    });
  }

  async findTicketByIdForAdmin(id: string) {
    return this.prisma.supportTicket.findUnique({
      where: { id },
      include: TICKET_ADMIN_INCLUDE,
    });
  }

  async findTicketByIdForCustomer(id: string, customerId: string) {
    return this.prisma.supportTicket.findFirst({
      where: { id, customerId },
      include: TICKET_DETAIL_INCLUDE,
    });
  }

  async findTicketOwnership(id: string) {
    return this.prisma.supportTicket.findUnique({
      where: { id },
      select: { id: true, customerId: true, assignedAgentId: true },
    });
  }

  async findCustomerTickets(
    customerId: string,
    params: {
      status?: TicketStatus;
      category?: TicketCategory;
      skip: number;
      take: number;
    },
  ) {
    const where: Prisma.SupportTicketWhereInput = {
      customerId,
      ...(params.status ? { status: params.status } : {}),
      ...(params.category ? { category: params.category } : {}),
    };

    const [items, total] = await this.prisma.$transaction([
      this.prisma.supportTicket.findMany({
        where,
        skip: params.skip,
        take: params.take,
        orderBy: { createdAt: 'desc' },
      }),

      this.prisma.supportTicket.count({ where }),
    ]);

    return { items, total };
  }

  private buildAdminWhere(
    params: AdminTicketFilterParams,
  ): Prisma.SupportTicketWhereInput {
    const where: Prisma.SupportTicketWhereInput = {};

    if (params.status) {
      where.status = params.status;
    }

    if (params.category) {
      where.category = params.category;
    }

    if (params.priority) {
      where.priority = params.priority;
    }

    if (params.unassigned) {
      where.assignedAgentId = null;
    } else if (params.assignedAgentId) {
      where.assignedAgentId = params.assignedAgentId;
    }

    if (params.search) {
      where.OR = [
        { ticketNumber: { contains: params.search, mode: 'insensitive' } },
        { subject: { contains: params.search, mode: 'insensitive' } },
        {
          customer: {
            firstName: { contains: params.search, mode: 'insensitive' },
          },
        },
        {
          customer: {
            lastName: { contains: params.search, mode: 'insensitive' },
          },
        },
        {
          customer: { email: { contains: params.search, mode: 'insensitive' } },
        },
      ];
    }

    return where;
  }

  async findAllForAdmin(
    params: AdminTicketFilterParams & { skip: number; take: number },
  ) {
    const where = this.buildAdminWhere(params);

    const [items, total] = await this.prisma.$transaction([
      this.prisma.supportTicket.findMany({
        where,
        skip: params.skip,
        take: params.take,
        orderBy: [{ priority: 'desc' }, { createdAt: 'desc' }],
        include: TICKET_ADMIN_INCLUDE,
      }),

      this.prisma.supportTicket.count({ where }),
    ]);

    return { items, total };
  }

  async createMessage(data: {
    ticketId: string;
    senderId?: string;
    senderType: 'CUSTOMER' | 'AGENT' | 'SYSTEM';
    message: string;
  }) {
    return this.prisma.ticketMessage.create({
      data,
      include: TICKET_MESSAGE_INCLUDE,
    });
  }

  async createAttachment(data: {
    ticketId: string;
    messageId?: string;
    uploadedById: string;
    fileUrl: string;
    fileName: string;
    mimeType: string;
    sizeBytes: number;
  }) {
    return this.prisma.ticketAttachment.create({ data });
  }

  async updateStatus(
    id: string,
    status: TicketStatus,
    extra: { firstResponseAt?: Date; resolvedAt?: Date } = {},
  ) {
    return this.prisma.supportTicket.update({
      where: { id },
      data: { status, ...extra },
    });
  }

  async updatePriority(id: string, priority: TicketPriority) {
    return this.prisma.supportTicket.update({
      where: { id },
      data: { priority },
    });
  }

  async assignAgent(id: string, agentId: string) {
    return this.prisma.supportTicket.update({
      where: { id },
      data: { assignedAgentId: agentId },
    });
  }

  async setFirstResponseIfUnset(id: string): Promise<void> {
    await this.prisma.supportTicket.updateMany({
      where: { id, firstResponseAt: null },
      data: { firstResponseAt: new Date() },
    });
  }

  /** Tickets open/in-progress past the SLA threshold and not yet escalated — read by the auto-escalation job. */
  async findOverdueTickets(thresholdDate: Date) {
    return this.prisma.supportTicket.findMany({
      where: {
        status: { in: [TicketStatus.OPEN, TicketStatus.IN_PROGRESS] },
        escalatedAt: null,
        createdAt: { lte: thresholdDate },
      },
      select: {
        id: true,
        customerId: true,
        ticketNumber: true,
        priority: true,
      },
    });
  }

  async markEscalated(id: string) {
    return this.prisma.supportTicket.update({
      where: { id },
      data: { escalatedAt: new Date(), priority: TicketPriority.URGENT },
    });
  }
}
