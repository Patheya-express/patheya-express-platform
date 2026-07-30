import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Query,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';

import { FileInterceptor } from '@nestjs/platform-express';

import {
  ApiBearerAuth,
  ApiBody,
  ApiConsumes,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiQuery,
  ApiTags,
} from '@nestjs/swagger';

import { UserRole } from '@prisma/client';

import { Throttle } from '@nestjs/throttler';

import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../../auth/guards/roles.guard';
import { Roles } from '../../auth/decorators/roles.decorator';
import { CurrentUser } from '../../auth/decorators/current-user.decorator';

import { TicketsService } from '../services/tickets.service';

import { CreateTicketDto } from '../dto/create-ticket.dto';
import { CreateTicketMessageDto } from '../dto/create-ticket-message.dto';
import { GetTicketsQueryDto } from '../dto/get-tickets-query.dto';
import { GetAdminTicketsQueryDto } from '../dto/get-admin-tickets-query.dto';
import { UpdateTicketStatusDto } from '../dto/update-ticket-status.dto';
import { UpdateTicketPriorityDto } from '../dto/update-ticket-priority.dto';
import { AssignTicketDto } from '../dto/assign-ticket.dto';
import { TicketResponseDto } from '../dto/ticket-response.dto';
import { PaginatedTicketsResponseDto } from '../dto/paginated-tickets-response.dto';
import { PaginatedAdminTicketsResponseDto } from '../dto/paginated-admin-tickets-response.dto';
import { AdminTicketResponseDto } from '../dto/admin-ticket-response.dto';

const STAFF_ROLES = [
  UserRole.SUPPORT_AGENT,
  UserRole.ADMIN,
  UserRole.SUPER_ADMIN,
];

@ApiTags('Support Tickets')
@ApiBearerAuth('JWT-auth')
@UseGuards(JwtAuthGuard)
@Controller('tickets')
export class TicketsController {
  constructor(private readonly ticketsService: TicketsService) {}

  @Post()
  @Throttle({ default: { limit: 10, ttl: 60000 } })
  @ApiOperation({ summary: 'Create a support ticket' })
  @ApiOkResponse({ type: TicketResponseDto })
  createTicket(
    @CurrentUser()
    user: any,

    @Body()
    dto: CreateTicketDto,
  ) {
    return this.ticketsService.createTicket(user.userId, dto);
  }

  @Get('me')
  @ApiOperation({ summary: "Get the authenticated customer's tickets" })
  @ApiQuery({ name: 'page', required: false, type: Number })
  @ApiQuery({ name: 'limit', required: false, type: Number })
  @ApiQuery({ name: 'status', required: false })
  @ApiQuery({ name: 'category', required: false })
  @ApiOkResponse({ type: PaginatedTicketsResponseDto })
  getMyTickets(
    @CurrentUser()
    user: any,

    @Query()
    query: GetTicketsQueryDto,
  ) {
    return this.ticketsService.getMyTickets(user.userId, query);
  }

  @Get('me/:id')
  @ApiOperation({
    summary:
      'Get a ticket owned by the authenticated customer, including its message thread',
  })
  @ApiParam({ name: 'id' })
  @ApiOkResponse({ type: TicketResponseDto })
  getMyTicketById(
    @CurrentUser()
    user: any,

    @Param('id')
    id: string,
  ) {
    return this.ticketsService.getMyTicketById(id, user.userId);
  }

  @Patch('me/:id/close')
  @ApiOperation({
    summary: 'Close a ticket owned by the authenticated customer',
  })
  @ApiParam({ name: 'id' })
  @ApiOkResponse({ type: TicketResponseDto })
  closeMyTicket(
    @CurrentUser()
    user: any,

    @Param('id')
    id: string,
  ) {
    return this.ticketsService.closeTicket(id, user.userId);
  }

  @Post(':id/messages')
  @Throttle({ default: { limit: 30, ttl: 60000 } })
  @ApiOperation({
    summary: 'Post a message on a ticket (customer or assigned staff)',
  })
  @ApiParam({ name: 'id' })
  @ApiOkResponse({ type: TicketResponseDto })
  postMessage(
    @CurrentUser()
    user: any,

    @Param('id')
    id: string,

    @Body()
    dto: CreateTicketMessageDto,
  ) {
    return this.ticketsService.postMessage(id, user, dto.message);
  }

  @Post(':id/attachments')
  @Throttle({ default: { limit: 20, ttl: 60000 } })
  @ApiOperation({
    summary: 'Upload a ticket attachment',
    description:
      'Mime-type allowlisted (JPEG/PNG/WebP/PDF) and capped at 8MB — validated server-side.',
  })
  @ApiParam({ name: 'id' })
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      properties: { file: { type: 'string', format: 'binary' } },
    },
  })
  @ApiOkResponse({ type: TicketResponseDto })
  @UseInterceptors(FileInterceptor('file'))
  uploadAttachment(
    @CurrentUser()
    user: any,

    @Param('id')
    id: string,

    @UploadedFile()
    file: Express.Multer.File,
  ) {
    return this.ticketsService.uploadAttachment(id, user, file);
  }

  // -------------------------------------------------------------------------
  // Admin / support-agent console
  // -------------------------------------------------------------------------

  @UseGuards(RolesGuard)
  @Roles(...STAFF_ROLES)
  @Get('admin')
  @ApiOperation({ summary: 'Admin/agent — list tickets platform-wide' })
  @ApiQuery({ name: 'page', required: false, type: Number })
  @ApiQuery({ name: 'limit', required: false, type: Number })
  @ApiQuery({ name: 'search', required: false })
  @ApiQuery({ name: 'status', required: false })
  @ApiQuery({ name: 'category', required: false })
  @ApiQuery({ name: 'priority', required: false })
  @ApiQuery({ name: 'assignedAgentId', required: false })
  @ApiQuery({ name: 'unassigned', required: false, type: Boolean })
  @ApiOkResponse({ type: PaginatedAdminTicketsResponseDto })
  getAllForAdmin(
    @Query()
    query: GetAdminTicketsQueryDto,
  ) {
    return this.ticketsService.getAllForAdmin(query);
  }

  @UseGuards(RolesGuard)
  @Roles(...STAFF_ROLES)
  @Get('admin/:id')
  @ApiOperation({ summary: 'Admin/agent — get full ticket detail' })
  @ApiParam({ name: 'id' })
  @ApiOkResponse({ type: TicketResponseDto })
  getTicketForAdmin(
    @Param('id')
    id: string,
  ) {
    return this.ticketsService.getTicketByIdForAdmin(id);
  }

  @UseGuards(RolesGuard)
  @Roles(...STAFF_ROLES)
  @Patch('admin/:id/assign')
  @ApiOperation({
    summary:
      'Admin/agent — assign a ticket to an agent (self-assign if agentId omitted)',
  })
  @ApiParam({ name: 'id' })
  @ApiOkResponse({ type: AdminTicketResponseDto })
  assignTicket(
    @CurrentUser()
    user: any,

    @Param('id')
    id: string,

    @Body()
    dto: AssignTicketDto,
  ) {
    return this.ticketsService.assignTicket(
      id,
      dto.agentId ?? user.userId,
      user.userId,
    );
  }

  @UseGuards(RolesGuard)
  @Roles(...STAFF_ROLES)
  @Patch('admin/:id/status')
  @ApiOperation({
    summary: 'Admin/agent — transition ticket status (audited on every change)',
  })
  @ApiParam({ name: 'id' })
  @ApiOkResponse({ type: TicketResponseDto })
  updateStatus(
    @CurrentUser()
    user: any,

    @Param('id')
    id: string,

    @Body()
    dto: UpdateTicketStatusDto,
  ) {
    return this.ticketsService.updateStatusAsStaff(id, dto.status, user.userId);
  }

  @UseGuards(RolesGuard)
  @Roles(...STAFF_ROLES)
  @Patch('admin/:id/priority')
  @ApiOperation({ summary: 'Admin/agent — change ticket priority' })
  @ApiParam({ name: 'id' })
  updatePriority(
    @CurrentUser()
    user: any,

    @Param('id')
    id: string,

    @Body()
    dto: UpdateTicketPriorityDto,
  ) {
    return this.ticketsService.updatePriority(id, dto.priority, user.userId);
  }
}
