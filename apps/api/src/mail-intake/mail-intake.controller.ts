import { Body, Controller, Get, HttpCode, Param, Post, Put, Query } from '@nestjs/common';
import { MailIntakeService } from './mail-intake.service';
import { CurrentUser, RequirePermissions } from '../auth/decorators';
import { AuthPrincipal } from '../auth/auth-principal';
import { Permission } from '../rbac/permissions';
import { BackfillDto, UpsertConnectionDto } from './dto';

/**
 * The email agent's control surface (ALIZE_AGENT_SCOPE A2/A3).
 *
 * There is deliberately NO endpoint that pays anything here — the agent reads
 * mail and writes charges; authorizing money stays in PaymentsController behind
 * a human action.
 */
@Controller('mail-intake')
export class MailIntakeController {
  constructor(private readonly intake: MailIntakeService) {}

  /** Current connection + status (never returns any credential). */
  @Get('connection')
  @RequirePermissions(Permission.MAIL_INTAKE_READ)
  async connection(@CurrentUser() principal: AuthPrincipal) {
    const conn = await this.intake.getConnection(principal);
    if (!conn) return null;
    return {
      id: conn.id,
      address: conn.address,
      host: conn.host,
      port: conn.port,
      use_tls: conn.useTls,
      username: conn.username,
      folder: conn.folder,
      secret_env_var: conn.secretEnvVar,
      /** Whether the host actually has that env var set — never its value. */
      secret_present: Boolean(process.env[conn.secretEnvVar]),
      /**
       * True when the agent is reading the built-in demo inbox instead of a real
       * mailbox. Surfaced so a demo "success" can never look like a live one.
       */
      using_demo_inbox: this.intake.usingDemoInbox,
      autonomy: conn.autonomy,
      active: conn.active,
      last_checked_at: conn.lastCheckedAt?.toISOString() ?? null,
      last_error: conn.lastError,
      scheduler_enabled: process.env.MAIL_INTAKE_ENABLED === 'true',
    };
  }

  @Put('connection')
  @RequirePermissions(Permission.MAIL_INTAKE_MANAGE)
  async upsert(@CurrentUser() principal: AuthPrincipal, @Body() dto: UpsertConnectionDto) {
    await this.intake.upsertConnection(principal, dto);
    return this.connection(principal);
  }

  /** Verify the credentials work, without ingesting anything. */
  @Post('connection/test')
  @HttpCode(200)
  @RequirePermissions(Permission.MAIL_INTAKE_MANAGE)
  test(@CurrentUser() principal: AuthPrincipal) {
    return this.intake.testConnection(principal);
  }

  /** "Check now" — run one intake pass immediately. */
  @Post('run')
  @HttpCode(200)
  @RequirePermissions(Permission.MAIL_INTAKE_MANAGE)
  run(@CurrentUser() principal: AuthPrincipal) {
    return this.intake.runNow(principal);
  }

  /**
   * "Catch up on older mail" — read history from before the mailbox was
   * connected. Repeat while `remaining > 0`. Safe to re-run: dedupe is on
   * Message-ID, so nothing is billed twice.
   */
  @Post('backfill')
  @HttpCode(200)
  @RequirePermissions(Permission.MAIL_INTAKE_MANAGE)
  backfill(@CurrentUser() principal: AuthPrincipal, @Body() dto: BackfillDto) {
    return this.intake.backfill(principal, dto.days ?? 14);
  }

  @Get('messages')
  @RequirePermissions(Permission.MAIL_INTAKE_READ)
  async messages(
    @CurrentUser() principal: AuthPrincipal,
    @Query('status') status?: string,
    @Query('limit') limit?: string,
  ) {
    const rows = await this.intake.listMessages(principal, status, limit ? Number(limit) : 50);
    return rows.map((m) => ({
      id: m.id,
      from_address: m.fromAddress,
      subject: m.subject,
      received_at: m.receivedAt.toISOString(),
      status: m.status,
      classification: m.classification,
      attachment_count: m.attachmentCount,
      confidence: m.confidence,
      container_id: m.containerId,
      extracted: m.extracted,
      error: m.error,
      reviewed_at: m.reviewedAt?.toISOString() ?? null,
    }));
  }

  /** Make the held charges from this message payable. Does NOT pay them. */
  @Post('messages/:id/confirm')
  @HttpCode(200)
  @RequirePermissions(Permission.MAIL_INTAKE_MANAGE)
  confirm(@CurrentUser() principal: AuthPrincipal, @Param('id') id: string) {
    return this.intake.confirm(principal, id);
  }

  /** Undo exactly what this message created (unpaid charges + its documents). */
  @Post('messages/:id/reject')
  @HttpCode(200)
  @RequirePermissions(Permission.MAIL_INTAKE_MANAGE)
  reject(@CurrentUser() principal: AuthPrincipal, @Param('id') id: string) {
    return this.intake.reject(principal, id);
  }
}
