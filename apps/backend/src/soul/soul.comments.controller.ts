import { Body, Controller, Get, Param, Post, Put, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { GetOrgFromRequest } from '@gitroom/nestjs-libraries/user/org.from.request';
import { Organization, SoulCommentStatus } from '@prisma/client';
import { SoulCommentsRepository } from '@gitroom/nestjs-libraries/soul/comments/soul.comments.repository';
import { SoulCommentsClassifierService } from '@gitroom/nestjs-libraries/soul/comments/soul.comments.classifier.service';
import { SoulCommentsCollectorService } from '@gitroom/nestjs-libraries/soul/comments/soul.comments.collector.service';
import { SoulCommentRuleDto } from '@gitroom/nestjs-libraries/dtos/soul/soul.comment.rule.dto';

// API do módulo Comentários (soulpostiz). Autenticação e organização vêm dos guards do Postiz.
@ApiTags('Soul Comments')
@Controller('/soul/comments')
export class SoulCommentsController {
  constructor(
    private _repo: SoulCommentsRepository,
    private _classifier: SoulCommentsClassifierService,
    private _collector: SoulCommentsCollectorService
  ) {}

  // Fila e histórico: ?status=QUEUED|AUTO_PENDING|NEW|... (padrão: QUEUED), ?customerId=, ?take=
  @Get('/')
  async list(
    @GetOrgFromRequest() org: Organization,
    @Query('status') status?: string,
    @Query('customerId') customerId?: string,
    @Query('take') take?: string
  ) {
    const st = (Object.values(SoulCommentStatus) as string[]).includes(status || '')
      ? (status as SoulCommentStatus)
      : SoulCommentStatus.QUEUED;
    return this._repo.listForOrg(org.id, st, customerId || undefined, Math.min(Number(take) || 50, 200));
  }

  @Get('/summary')
  async summary(@GetOrgFromRequest() org: Organization) {
    return {
      byStatus: await this._repo.countByStatus(org.id),
      engine: this._classifier.engineName(),
    };
  }

  @Get('/rules')
  async rules(@GetOrgFromRequest() org: Organization) {
    return this._repo.listRules(org.id);
  }

  @Put('/rules')
  async saveRule(@GetOrgFromRequest() org: Organization, @Body() body: SoulCommentRuleDto) {
    return this._repo.upsertRule(org.id, body);
  }

  // Força uma coleta + classificação agora (sem esperar os 10 min do workflow)
  @Post('/run')
  async run(@GetOrgFromRequest() org: Organization) {
    const collect = await this._collector.collectAll();
    const classify = await this._classifier.classifyNew(100);
    return { collect, classify };
  }

  // Ação manual: QUEUED -> IGNORED (descartar) ou -> AUTO_PENDING (aprovar pra resposta automática)
  @Post('/:id/status')
  async setStatus(
    @GetOrgFromRequest() org: Organization,
    @Param('id') id: string,
    @Body('status') status: 'IGNORED' | 'AUTO_PENDING' | 'QUEUED'
  ) {
    const allowed: SoulCommentStatus[] = [SoulCommentStatus.IGNORED, SoulCommentStatus.AUTO_PENDING, SoulCommentStatus.QUEUED];
    if (!allowed.includes(status as SoulCommentStatus)) {
      return { error: 'status inválido' };
    }
    return this._repo.setStatus(org.id, id, status as SoulCommentStatus);
  }
}
