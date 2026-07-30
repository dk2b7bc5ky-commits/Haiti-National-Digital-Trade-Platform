import { Body, Controller, Get, Param, Post, Put, Query } from '@nestjs/common';
import { NotificationsService } from './notifications.service';
import { CurrentUser, RequirePermissions } from '../auth/decorators';
import { AuthPrincipal } from '../auth/auth-principal';
import { Permission } from '../rbac/permissions';
import { UpdatePreferencesDto } from './dto';

/** Notification feed, bell, and per-user preferences (spec §6c–§6e). */
@Controller('notifications')
export class NotificationsController {
  constructor(private readonly notifications: NotificationsService) {}

  @Get()
  @RequirePermissions(Permission.NOTIFICATION_READ)
  list(
    @CurrentUser() principal: AuthPrincipal,
    @Query('container_id') containerId?: string,
    @Query('type') type?: string,
    @Query('unread') unread?: string,
    @Query('limit') limit?: string,
  ) {
    return this.notifications.list(principal, {
      containerId,
      type,
      unreadOnly: unread === 'true',
      limit: Math.min(Number(limit) || 200, 500),
    });
  }

  @Get('unread-count')
  @RequirePermissions(Permission.NOTIFICATION_READ)
  async unreadCount(@CurrentUser() principal: AuthPrincipal) {
    return { unread: await this.notifications.unreadCount(principal) };
  }

  @Get('preferences')
  @RequirePermissions(Permission.NOTIFICATION_READ)
  preferences(@CurrentUser() principal: AuthPrincipal) {
    return this.notifications.getPreferences(principal);
  }

  @Put('preferences')
  @RequirePermissions(Permission.NOTIFICATION_READ)
  setPreferences(@CurrentUser() principal: AuthPrincipal, @Body() dto: UpdatePreferencesDto) {
    return this.notifications.setPreferences(principal, dto);
  }

  @Post('read-all')
  @RequirePermissions(Permission.NOTIFICATION_READ)
  markAllRead(@CurrentUser() principal: AuthPrincipal) {
    return this.notifications.markAllRead(principal);
  }

  @Post(':id/read')
  @RequirePermissions(Permission.NOTIFICATION_READ)
  async markRead(@CurrentUser() principal: AuthPrincipal, @Param('id') id: string) {
    await this.notifications.markRead(principal, id);
    return { ok: true };
  }
}
