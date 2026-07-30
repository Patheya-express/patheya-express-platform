import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';

import {
  AuditAction,
  NotificationType,
  Prisma,
  TicketPriority,
  TicketStatus,
} from '@prisma/client';

import {
  TicketsRepository,
  TICKET_ADMIN_INCLUDE,
  TICKET_DETAIL_INCLUDE,
} from '../repositories/tickets.repository';

import { StorageService } from '../../storage/services/storage.service';
import { RealtimeService } from '../../realtime/services/realtime.service';
import { NotificationsService } from '../../notifications/services/notifications.service';
import { AuditService } from '../../audit/services/audit.service';
import { EventBusService } from '../../../core/events/event-bus.service';

import { UploadFile } from '../../../shared/types/upload-file.type';
import { AuthenticatedUser } from '../../../shared/authorization/order-access.util';

import { CreateTicketDto } from '../dto/create-ticket.dto';
import { GetTicketsQueryDto } from '../dto/get-tickets-query.dto';
import { GetAdminTicketsQueryDto } from '../dto/get-admin-tickets-query.dto';
import { TicketResponseDto } from '../dto/ticket-response.dto';
import { PaginatedTicketsResponseDto } from '../dto/paginated-tickets-response.dto';
import { PaginatedAdminTicketsResponseDto } from '../dto/paginated-admin-tickets-response.dto';
import { AdminTicketResponseDto } from '../dto/admin-ticket-response.dto';

const TERMINAL_STATUSES: TicketStatus[] = [
  TicketStatus.RESOLVED,
  TicketStatus.CLOSED,
];

/** Every transition a ticket may take — mirrors the OrderStatus state-machine convention used elsewhere in this codebase. */
const TICKET_STATUS_TRANSITIONS: Record<TicketStatus, TicketStatus[]> = {
  [TicketStatus.OPEN]: [
    TicketStatus.IN_PROGRESS,
    TicketStatus.RESOLVED,
    TicketStatus.CLOSED,
  ],
  [TicketStatus.IN_PROGRESS]: [
    TicketStatus.WAITING_ON_CUSTOMER,
    TicketStatus.RESOLVED,
    TicketStatus.CLOSED,
  ],
  [TicketStatus.WAITING_ON_CUSTOMER]: [
    TicketStatus.IN_PROGRESS,
    TicketStatus.RESOLVED,
    TicketStatus.CLOSED,
  ],
  [TicketStatus.RESOLVED]: [TicketStatus.CLOSED, TicketStatus.IN_PROGRESS],
  [TicketStatus.CLOSED]: [],
};

const ALLOWED_ATTACHMENT_MIME_TYPES = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
  'application/pdf',
]);

const MAX_ATTACHMENT_SIZE_BYTES = 8 * 1024 * 1024;

type TicketWithMessages = Prisma.SupportTicketGetPayload<{
  include: typeof TICKET_DETAIL_INCLUDE;
}>;

type TicketWithCustomer = Prisma.SupportTicketGetPayload<{
  include: typeof TICKET_ADMIN_INCLUDE;
}>;

function toTicketResponse(ticket: TicketWithMessages): TicketResponseDto {
  return {
    id: ticket.id,
    ticketNumber: ticket.ticketNumber,
    customerId: ticket.customerId,
    assignedAgentId: ticket.assignedAgentId ?? undefined,
    orderId: ticket.orderId ?? undefined,
    paymentId: ticket.paymentId ?? undefined,
    category: ticket.category,
    priority: ticket.priority,
    status: ticket.status,
    subject: ticket.subject,
    description: ticket.description,
    firstResponseAt: ticket.firstResponseAt ?? undefined,
    resolvedAt: ticket.resolvedAt ?? undefined,
    escalatedAt: ticket.escalatedAt ?? undefined,
    createdAt: ticket.createdAt,
    updatedAt: ticket.updatedAt,
    messages: ticket.messages.map((message) => ({
      id: message.id,
      senderId: message.senderId ?? undefined,
      senderType: message.senderType,
      message: message.message,
      attachments: message.attachments.map((attachment) => ({
        id: attachment.id,
        fileUrl: attachment.fileUrl,
        fileName: attachment.fileName,
        mimeType: attachment.mimeType,
        sizeBytes: attachment.sizeBytes,
        uploadedById: attachment.uploadedById,
        createdAt: attachment.createdAt,
      })),
      createdAt: message.createdAt,
    })),
  };
}

function toAdminTicketResponse(
  ticket: TicketWithCustomer,
): AdminTicketResponseDto {
  return {
    id: ticket.id,
    ticketNumber: ticket.ticketNumber,
    customer: {
      id: ticket.customer.id,
      firstName: ticket.customer.firstName,
      lastName: ticket.customer.lastName ?? undefined,
      email: ticket.customer.email ?? undefined,
      phone: ticket.customer.phone ?? undefined,
    },
    assignedAgentId: ticket.assignedAgentId ?? undefined,
    orderId: ticket.orderId ?? undefined,
    paymentId: ticket.paymentId ?? undefined,
    category: ticket.category,
    priority: ticket.priority,
    status: ticket.status,
    subject: ticket.subject,
    description: ticket.description,
    firstResponseAt: ticket.firstResponseAt ?? undefined,
    resolvedAt: ticket.resolvedAt ?? undefined,
    escalatedAt: ticket.escalatedAt ?? undefined,
    createdAt: ticket.createdAt,
    updatedAt: ticket.updatedAt,
  };
}

@Injectable()
export class TicketsService {
  constructor(
    private readonly ticketsRepository: TicketsRepository,
    private readonly storageService: StorageService,
    private readonly realtimeService: RealtimeService,
    private readonly notificationsService: NotificationsService,
    private readonly auditService: AuditService,
    private readonly eventBus: EventBusService,
  ) {}

  async createTicket(
    customerId: string,
    dto: CreateTicketDto,
  ): Promise<TicketResponseDto> {
    const ticketNumber = `TKT-${Date.now()}`;

    const ticket = await this.ticketsRepository.createTicket({
      ticketNumber,
      customerId,
      category: dto.category,
      priority: dto.priority ?? TicketPriority.MEDIUM,
      subject: dto.subject,
      description: dto.description,
      orderId: dto.orderId,
      paymentId: dto.paymentId,
    });

    await this.auditService.log(
      customerId,
      'SupportTicket',
      ticket.id,
      AuditAction.CREATE,
      undefined,
      {
        status: ticket.status,
        category: ticket.category,
      },
    );

    this.realtimeService.emitToRoom('support-queue', 'ticket.created', {
      ticketId: ticket.id,
      ticketNumber: ticket.ticketNumber,
      category: ticket.category,
      priority: ticket.priority,
    });

    return toTicketResponse(ticket);
  }

  async getMyTickets(
    customerId: string,
    query: GetTicketsQueryDto,
  ): Promise<PaginatedTicketsResponseDto> {
    const skip = (query.page - 1) * query.limit;

    const { items, total } = await this.ticketsRepository.findCustomerTickets(
      customerId,
      {
        status: query.status,
        category: query.category,
        skip,
        take: query.limit,
      },
    );

    return {
      items: items.map((ticket) => ({
        id: ticket.id,
        ticketNumber: ticket.ticketNumber,
        assignedAgentId: ticket.assignedAgentId ?? undefined,
        category: ticket.category,
        priority: ticket.priority,
        status: ticket.status,
        subject: ticket.subject,
        orderId: ticket.orderId ?? undefined,
        createdAt: ticket.createdAt,
        updatedAt: ticket.updatedAt,
      })),
      total,
      page: query.page,
      limit: query.limit,
      totalPages: Math.ceil(total / query.limit),
    };
  }

  async getMyTicketById(
    id: string,
    customerId: string,
  ): Promise<TicketResponseDto> {
    const ticket = await this.ticketsRepository.findTicketByIdForCustomer(
      id,
      customerId,
    );

    if (!ticket) {
      throw new NotFoundException('Ticket not found');
    }

    return toTicketResponse(ticket);
  }

  private async assertTicketAccess(id: string, user: AuthenticatedUser) {
    const ticket = await this.ticketsRepository.findTicketOwnership(id);

    if (!ticket) {
      throw new NotFoundException('Ticket not found');
    }

    const isStaff =
      user.role === 'ADMIN' ||
      user.role === 'SUPER_ADMIN' ||
      user.role === 'SUPPORT_AGENT';

    if (!isStaff && ticket.customerId !== user.userId) {
      throw new ForbiddenException('You do not have access to this ticket');
    }

    return ticket;
  }

  /** Posts a message on behalf of whoever is authenticated — customer replies keep the ticket WAITING_ON_CUSTOMER-eligible; agent replies stamp firstResponseAt once. */
  async postMessage(
    id: string,
    user: AuthenticatedUser,
    message: string,
  ): Promise<TicketResponseDto> {
    const ticket = await this.assertTicketAccess(id, user);

    const isStaff = user.role !== 'CUSTOMER';

    await this.ticketsRepository.createMessage({
      ticketId: id,
      senderId: user.userId,
      senderType: isStaff ? 'AGENT' : 'CUSTOMER',
      message,
    });

    if (isStaff) {
      await this.ticketsRepository.setFirstResponseIfUnset(id);
    }

    this.realtimeService.emitToRoom(`ticket:${id}`, 'ticket.message', {
      ticketId: id,
      senderType: isStaff ? 'AGENT' : 'CUSTOMER',
      message,
    });

    this.realtimeService.emitToUser(ticket.customerId, 'ticket.message', {
      ticketId: id,
      senderType: isStaff ? 'AGENT' : 'CUSTOMER',
      message,
    });

    if (ticket.assignedAgentId) {
      this.realtimeService.emitToUser(
        ticket.assignedAgentId,
        'ticket.message',
        {
          ticketId: id,
          senderType: isStaff ? 'AGENT' : 'CUSTOMER',
          message,
        },
      );
    }

    if (isStaff) {
      await this.notificationsService.createNotification(
        ticket.customerId,
        NotificationType.TICKET_MESSAGE,
        'New reply on your support ticket',
        message.length > 120 ? `${message.slice(0, 117)}...` : message,
        { referenceType: 'TICKET', referenceId: id },
      );
    } else if (ticket.orderId) {
      // A customer message on a ticket linked to an order is surfaced to that order's
      // restaurant — see RestaurantOrderNotificationListener.
      await this.eventBus.publish('order.customer.message', {
        orderId: ticket.orderId,
        ticketId: id,
        message: message.length > 120 ? `${message.slice(0, 117)}...` : message,
      });
    }

    return toTicketResponse(await this.getTicketOrThrow(id));
  }

  private async getTicketOrThrow(id: string): Promise<TicketWithMessages> {
    const ticket = await this.ticketsRepository.findTicketById(id);

    if (!ticket) {
      throw new NotFoundException('Ticket not found');
    }

    return ticket;
  }

  async uploadAttachment(
    id: string,
    user: AuthenticatedUser,
    file: UploadFile,
  ): Promise<TicketResponseDto> {
    await this.assertTicketAccess(id, user);

    if (!file) {
      throw new BadRequestException('No file provided');
    }

    if (!ALLOWED_ATTACHMENT_MIME_TYPES.has(file.mimetype)) {
      throw new BadRequestException(
        `Unsupported file type "${file.mimetype}". Allowed: JPEG, PNG, WebP, PDF.`,
      );
    }

    if (file.size > MAX_ATTACHMENT_SIZE_BYTES) {
      throw new BadRequestException('File exceeds the 8MB size limit');
    }

    const fileUrl = await this.storageService.upload(
      file,
      'ticket-attachments',
    );

    await this.ticketsRepository.createAttachment({
      ticketId: id,
      uploadedById: user.userId,
      fileUrl,
      fileName: file.originalname,
      mimeType: file.mimetype,
      sizeBytes: file.size,
    });

    return toTicketResponse(await this.getTicketOrThrow(id));
  }

  async closeTicket(
    id: string,
    customerId: string,
  ): Promise<TicketResponseDto> {
    const ticket = await this.ticketsRepository.findTicketByIdForCustomer(
      id,
      customerId,
    );

    if (!ticket) {
      throw new NotFoundException('Ticket not found');
    }

    return this.transitionStatus(
      id,
      ticket.status,
      TicketStatus.CLOSED,
      customerId,
    );
  }

  async getAllForAdmin(
    query: GetAdminTicketsQueryDto,
  ): Promise<PaginatedAdminTicketsResponseDto> {
    const skip = (query.page - 1) * query.limit;

    const { items, total } = await this.ticketsRepository.findAllForAdmin({
      search: query.search,
      status: query.status,
      category: query.category,
      priority: query.priority,
      assignedAgentId: query.assignedAgentId,
      unassigned: query.unassigned === 'true',
      skip,
      take: query.limit,
    });

    return {
      items: items.map(toAdminTicketResponse),
      total,
      page: query.page,
      limit: query.limit,
      totalPages: Math.ceil(total / query.limit),
    };
  }

  async getTicketByIdForAdmin(id: string): Promise<TicketResponseDto> {
    const ticket = await this.ticketsRepository.findTicketById(id);

    if (!ticket) {
      throw new NotFoundException('Ticket not found');
    }

    return toTicketResponse(ticket);
  }

  async assignTicket(
    id: string,
    agentId: string,
    actingUserId: string,
  ): Promise<AdminTicketResponseDto> {
    const ticket = await this.ticketsRepository.findTicketOwnership(id);

    if (!ticket) {
      throw new NotFoundException('Ticket not found');
    }

    await this.ticketsRepository.assignAgent(id, agentId);

    await this.auditService.log(
      actingUserId,
      'SupportTicket',
      id,
      AuditAction.UPDATE,
      { assignedAgentId: ticket.assignedAgentId ?? null },
      { assignedAgentId: agentId },
    );

    const full = await this.ticketsRepository.findTicketByIdForAdmin(id);

    if (!full) {
      throw new NotFoundException('Ticket not found');
    }

    return toAdminTicketResponse(full);
  }

  async updatePriority(
    id: string,
    priority: TicketPriority,
    actingUserId: string,
  ): Promise<void> {
    const ticket = await this.ticketsRepository.findTicketOwnership(id);

    if (!ticket) {
      throw new NotFoundException('Ticket not found');
    }

    await this.ticketsRepository.updatePriority(id, priority);

    await this.auditService.log(
      actingUserId,
      'SupportTicket',
      id,
      AuditAction.UPDATE,
      undefined,
      {
        priority,
      },
    );
  }

  async updateStatusAsStaff(
    id: string,
    status: TicketStatus,
    actingUserId: string,
  ): Promise<TicketResponseDto> {
    const ticket = await this.ticketsRepository.findTicketOwnership(id);

    if (!ticket) {
      throw new NotFoundException('Ticket not found');
    }

    const full = await this.ticketsRepository.findTicketById(id);

    if (!full) {
      throw new NotFoundException('Ticket not found');
    }

    return this.transitionStatus(id, full.status, status, actingUserId);
  }

  private async transitionStatus(
    id: string,
    currentStatus: TicketStatus,
    nextStatus: TicketStatus,
    actingUserId: string,
  ): Promise<TicketResponseDto> {
    const allowed = TICKET_STATUS_TRANSITIONS[currentStatus] ?? [];

    if (!allowed.includes(nextStatus)) {
      throw new BadRequestException(
        `Invalid ticket status transition from ${currentStatus} to ${nextStatus}`,
      );
    }

    const extra: { firstResponseAt?: Date; resolvedAt?: Date } = {};

    if (
      nextStatus === TicketStatus.RESOLVED &&
      !TERMINAL_STATUSES.includes(currentStatus)
    ) {
      extra.resolvedAt = new Date();
    }

    const updated = await this.ticketsRepository.updateStatus(
      id,
      nextStatus,
      extra,
    );

    await this.auditService.log(
      actingUserId,
      'SupportTicket',
      id,
      AuditAction.STATUS_CHANGE,
      { status: currentStatus },
      { status: nextStatus },
    );

    this.realtimeService.emitToUser(
      updated.customerId,
      'ticket.status.changed',
      {
        ticketId: id,
        status: nextStatus,
      },
    );

    await this.notificationsService.createNotification(
      updated.customerId,
      NotificationType.TICKET_STATUS_CHANGED,
      'Support ticket updated',
      `Your ticket ${updated.ticketNumber} is now ${nextStatus.replace(/_/g, ' ').toLowerCase()}.`,
      { referenceType: 'TICKET', referenceId: id },
    );

    return toTicketResponse(await this.getTicketOrThrow(id));
  }
}
