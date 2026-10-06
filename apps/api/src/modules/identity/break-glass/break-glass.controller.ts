import { Controller, Delete, Get, HttpCode, Inject, Post, Req, Res } from '@nestjs/common';
import { z } from 'zod';

import { UuidSchema } from '../../../common/dto.js';
import { NoResponseReplay } from '../../../common/idempotency/idempotency.interceptor.js';
import { Public } from '../../../common/security/public.decorator.js';
import { ZBody, ZParam } from '../../../common/validation/zod.js';
import { ApiOperation, ApiResponse, ApiTag } from '../../../openapi/metadata.js';
import { RequirePermissions } from '../../authz/permissions.js';
import { PASSWORD_MAX_LENGTH } from '../crypto/password.js';
import { BrowserResponder } from '../login/browser-responder.js';

import { BreakGlassService } from './break-glass.service.js';

import type { FastifyReply, FastifyRequest } from 'fastify';

export const BreakGlassLoginSchema = z
  .strictObject({
    tenant: z.string().regex(/^[a-z0-9][a-z0-9-]{0,62}$/),
    email: z.email().max(320),
    password: z.string().min(1).max(PASSWORD_MAX_LENGTH),
    code: z.string().regex(/^\d{6}$/),
  })
  .meta({ id: 'BreakGlassLogin' });
export const BreakGlassLoginResponseSchema = z
  .object({ expiresAt: z.string(), csrfToken: z.string() })
  .meta({ id: 'BreakGlassLoginResponse' });
export const BreakGlassEnrollSchema = z
  .strictObject({ userId: UuidSchema, password: z.string().min(1).max(PASSWORD_MAX_LENGTH) })
  .meta({ id: 'BreakGlassEnroll' });
export const BreakGlassEnrollmentSchema = z
  .object({ userId: z.uuid(), totpUri: z.string(), totpSecret: z.string() })
  .meta({ id: 'BreakGlassEnrollment', description: 'Shown once; @secret' });
export const BreakGlassActivateSchema = z
  .strictObject({ code: z.string().regex(/^\d{6}$/) })
  .meta({ id: 'BreakGlassActivate' });
export const BreakGlassAccountSchema = z
  .object({
    userId: z.uuid(),
    status: z.enum(['pending_mfa', 'active', 'disabled']),
    lockedUntil: z.string().nullable(),
    lastUsedAt: z.string().nullable(),
    createdAt: z.string(),
  })
  .meta({ id: 'BreakGlassAccount' });

@ApiTag('auth')
@Controller()
export class BreakGlassController {
  constructor(
    @Inject(BreakGlassService) private readonly breakGlass: BreakGlassService,
    @Inject(BrowserResponder) private readonly browser: BrowserResponder,
  ) {}

  @ApiOperation({
    summary:
      'Break-glass sign-in (password + TOTP), accepted only from admin-web; every attempt is a critical audit event',
  })
  @ApiResponse(200, 'Signed in; the session cookie is set', BreakGlassLoginResponseSchema)
  @Public()
  @HttpCode(200)
  @Post('auth/break-glass/login')
  async login(
    @ZBody(BreakGlassLoginSchema) body: z.output<typeof BreakGlassLoginSchema>,
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ) {
    const created = await this.breakGlass.login({
      ...body,
      origin: request.headers.origin,
      ip: request.ip,
      userAgent: (request.headers['user-agent'] ?? '').slice(0, 512),
    });
    this.browser.cookie.set(
      reply,
      created.token,
      Math.floor((created.record.absoluteExpiresAt - created.record.createdAt) / 1000),
    );
    void reply.header('cache-control', 'no-store');
    return {
      expiresAt: new Date(created.record.absoluteExpiresAt).toISOString(),
      csrfToken: created.record.csrfToken,
    };
  }

  @ApiOperation({ summary: 'List break-glass accounts' })
  @ApiResponse(200, 'Accounts', z.array(BreakGlassAccountSchema))
  @RequirePermissions('read:BreakGlassAccount')
  @Get('v1/break-glass-accounts')
  list() {
    return this.breakGlass.list();
  }

  @ApiOperation({
    summary: 'Enroll (or re-enroll) a break-glass account; returns the TOTP secret once',
  })
  @ApiResponse(201, 'Enrollment pending MFA confirmation', BreakGlassEnrollmentSchema)
  @RequirePermissions('manage:BreakGlassAccount')
  @NoResponseReplay()
  @Post('v1/break-glass-accounts')
  async enroll(
    @ZBody(BreakGlassEnrollSchema) body: z.output<typeof BreakGlassEnrollSchema>,
    @Res({ passthrough: true }) reply: FastifyReply,
  ) {
    void reply.header('cache-control', 'no-store');
    return this.breakGlass.enroll(body.userId, body.password);
  }

  @ApiOperation({ summary: 'Confirm the authenticator with a first TOTP code' })
  @ApiResponse(200, 'Activated', BreakGlassAccountSchema)
  @RequirePermissions('manage:BreakGlassAccount')
  @HttpCode(200)
  @Post('v1/break-glass-accounts/:userId/activate')
  activate(
    @ZParam('userId', UuidSchema) userId: string,
    @ZBody(BreakGlassActivateSchema) body: { code: string },
  ) {
    return this.breakGlass.activate(userId, body.code);
  }

  @ApiOperation({ summary: 'Disable a break-glass account (ends its sessions)' })
  @ApiResponse(204, 'Disabled')
  @RequirePermissions('manage:BreakGlassAccount')
  @HttpCode(204)
  @Delete('v1/break-glass-accounts/:userId')
  async disable(@ZParam('userId', UuidSchema) userId: string): Promise<void> {
    await this.breakGlass.disable(userId);
  }
}
