import { Injectable } from '@nestjs/common';
import { PrismaRepository } from '@gitroom/nestjs-libraries/database/prisma/prisma.service';
import { Prisma, SoulCommentMode, SoulCommentRule, SoulCommentStatus } from '@prisma/client';
import { SoulCommentRuleDto } from '@gitroom/nestjs-libraries/dtos/soul/soul.comment.rule.dto';

// Providers do Instagram que o coletor entende. Os dois usam a Graph API com o mesmo
// formato de mídia/comentários; muda só o host e a forma do token.
export const SOUL_INSTAGRAM_PROVIDERS = ['instagram-standalone', 'instagram'];

// Regra usada quando a organização não cadastrou nenhuma: tudo passa por revisão.
const FALLBACK_RULE = {
  id: 'fallback',
  organizationId: '',
  customerId: null,
  mode: SoulCommentMode.REVIEW_ALL,
  autoLabels: ['PRAISE', 'QUESTION_ANSWERABLE'],
  ignoreLabels: ['SPAM'],
  voiceProfile: null,
  knowledgeSummary: null,
  knowledgeUrl: null,
  notifyEmails: [],
  createdAt: new Date(0),
  updatedAt: new Date(0),
} as unknown as SoulCommentRule;

@Injectable()
export class SoulCommentsRepository {
  constructor(
    private _prisma: PrismaRepository<
      'soulComment' | 'soulMediaSync' | 'soulCommentRule' | 'integration' | 'post'
    >
  ) {}

  // ---------- canais e posts ----------

  listInstagramIntegrations() {
    return this._prisma.model.integration.findMany({
      where: {
        providerIdentifier: { in: SOUL_INSTAGRAM_PROVIDERS },
        disabled: false,
        deletedAt: null,
        inBetweenSteps: false,
        refreshNeeded: false,
      },
    });
  }

  findPostByReleaseId(integrationId: string, releaseId: string) {
    return this._prisma.model.post.findFirst({
      where: { integrationId, releaseId, deletedAt: null },
      select: { id: true, publishDate: true },
    });
  }

  // ---------- mídias ----------

  getMediaSync(integrationId: string, externalPostId: string) {
    return this._prisma.model.soulMediaSync.findUnique({
      where: { integrationId_externalPostId: { integrationId, externalPostId } },
    });
  }

  upsertMediaSync(data: {
    organizationId: string;
    integrationId: string;
    externalPostId: string;
    postId?: string | null;
    permalink?: string | null;
    caption?: string | null;
    publishedAt?: Date | null;
    commentsCount: number;
    lastSyncAt?: Date | null;
  }) {
    const { integrationId, externalPostId, ...rest } = data;
    return this._prisma.model.soulMediaSync.upsert({
      where: { integrationId_externalPostId: { integrationId, externalPostId } },
      create: { integrationId, externalPostId, ...rest },
      update: rest,
    });
  }

  getMediaByExternalIds(externalPostIds: string[]) {
    if (!externalPostIds.length) return Promise.resolve([]);
    return this._prisma.model.soulMediaSync.findMany({
      where: { externalPostId: { in: externalPostIds } },
      select: { externalPostId: true, integrationId: true, permalink: true, caption: true },
    });
  }

  // ---------- comentários ----------

  // Cria o comentário como NEW; se já existe, só atualiza texto e payload bruto
  // (o status é do fluxo de resposta, nunca volta pra NEW por causa de uma releitura).
  upsertComment(data: {
    organizationId: string;
    integrationId: string;
    postId?: string | null;
    externalPostId: string;
    externalCommentId: string;
    parentExternalId?: string | null;
    authorUsername?: string | null;
    authorId?: string | null;
    text: string;
    commentedAt: Date;
    postPublishedAt?: Date | null;
    raw?: Prisma.InputJsonValue;
  }) {
    const { externalCommentId, text, raw, authorUsername, ...rest } = data;
    return this._prisma.model.soulComment.upsert({
      where: { externalCommentId },
      create: { externalCommentId, text, raw, authorUsername, ...rest },
      update: { text, raw, authorUsername, fetchedAt: new Date() },
    });
  }

  // Marca o comentário como respondido quando a resposta veio da própria conta
  // (pelo app do Instagram ou por nós). Não sobrescreve AUTO_REPLIED.
  async markRepliedByOwner(
    externalCommentId: string,
    replyExternalId: string,
    repliedAt: Date,
    replyText: string
  ) {
    const existing = await this._prisma.model.soulComment.findUnique({
      where: { externalCommentId },
      select: { status: true },
    });
    if (!existing || existing.status === SoulCommentStatus.AUTO_REPLIED) {
      return null;
    }
    return this._prisma.model.soulComment.update({
      where: { externalCommentId },
      data: {
        status: SoulCommentStatus.REPLIED,
        replyExternalId,
        repliedAt,
        replyText,
      },
    });
  }

  listNewForClassification(take = 50) {
    return this._prisma.model.soulComment.findMany({
      where: { status: SoulCommentStatus.NEW },
      orderBy: { commentedAt: 'asc' },
      take,
    });
  }

  applyClassification(
    id: string,
    data: {
      classification: string;
      classificationConfidence: number;
      classificationReason: string;
      status: SoulCommentStatus;
    }
  ) {
    return this._prisma.model.soulComment.update({
      where: { id },
      data: { ...data, classifiedAt: new Date() },
    });
  }

  setStatus(organizationId: string, id: string, status: SoulCommentStatus) {
    return this._prisma.model.soulComment.update({
      where: { id, organizationId },
      data: { status },
    });
  }

  countByStatus(organizationId: string) {
    return this._prisma.model.soulComment.groupBy({
      by: ['status'],
      where: { organizationId },
      _count: { _all: true },
    });
  }

  listByStatus(organizationId: string, status: SoulCommentStatus, take = 50) {
    return this._prisma.model.soulComment.findMany({
      where: { organizationId, status },
      orderBy: { commentedAt: 'desc' },
      take,
    });
  }

  // Lista pra tela: mais novo primeiro, com filtro opcional por Customer (via canal).
  async listForOrg(organizationId: string, status: SoulCommentStatus, customerId?: string, take = 50) {
    let integrationIds: string[] | undefined;
    if (customerId) {
      const ints = await this._prisma.model.integration.findMany({
        where: { organizationId, customerId, deletedAt: null },
        select: { id: true },
      });
      integrationIds = ints.map((i) => i.id);
    }
    return this._prisma.model.soulComment.findMany({
      where: {
        organizationId,
        status,
        ...(integrationIds ? { integrationId: { in: integrationIds } } : {}),
      },
      orderBy: { commentedAt: 'desc' },
      take,
    });
  }

  // ---------- respostas (SPTZ-5) ----------

  getIntegration(id: string) {
    return this._prisma.model.integration.findUnique({ where: { id } });
  }

  // Todos os Customers/orgs: usado pelo loop do orchestrator
  listByStatusAll(status: SoulCommentStatus, take = 50) {
    return this._prisma.model.soulComment.findMany({
      where: { status },
      orderBy: { commentedAt: 'asc' },
      take,
    });
  }

  getById(organizationId: string, id: string) {
    return this._prisma.model.soulComment.findFirst({ where: { id, organizationId } });
  }

  setReplyDraft(id: string, replyText: string, replyEngine: string) {
    return this._prisma.model.soulComment.update({
      where: { id },
      data: { replyText, replyEngine, replyGeneratedAt: new Date(), status: SoulCommentStatus.REPLY_READY, replyError: null },
    });
  }

  setReplied(id: string, replyText: string, replyExternalId: string) {
    return this._prisma.model.soulComment.update({
      where: { id },
      data: { status: SoulCommentStatus.AUTO_REPLIED, replyText, replyExternalId, repliedAt: new Date(), replyError: null },
    });
  }

  // Erro ao publicar: guarda o motivo; depois do limite de tentativas volta pra fila com o texto pronto
  setReplyError(id: string, replyError: string, giveUp: boolean, replyAttempts?: number) {
    return this._prisma.model.soulComment.update({
      where: { id },
      data: {
        replyError,
        ...(replyAttempts !== undefined ? { replyAttempts } : {}),
        ...(giveUp ? { status: SoulCommentStatus.QUEUED } : {}),
      },
    });
  }

  // ---------- regras ----------

  listRules(organizationId: string) {
    return this._prisma.model.soulCommentRule.findMany({ where: { organizationId } });
  }

  // Regra efetiva: a do Customer do canal; senão a padrão da organização (customerId nulo);
  // senão o fallback conservador (tudo pra revisão).
  async getEffectiveRule(organizationId: string, integrationId: string): Promise<SoulCommentRule> {
    const integration = await this._prisma.model.integration.findUnique({
      where: { id: integrationId },
      select: { customerId: true },
    });
    const rules = await this._prisma.model.soulCommentRule.findMany({ where: { organizationId } });
    const byCustomer = integration?.customerId ? rules.find((r) => r.customerId === integration.customerId) : undefined;
    const orgDefault = rules.find((r) => r.customerId === null);
    return byCustomer || orgDefault || { ...FALLBACK_RULE, organizationId };
  }

  async upsertRule(organizationId: string, dto: SoulCommentRuleDto) {
    const customerId = dto.customerId || null;
    const existing = await this._prisma.model.soulCommentRule.findFirst({
      where: { organizationId, customerId },
    });
    const data = {
      mode: dto.mode as SoulCommentMode,
      autoLabels: dto.autoLabels ?? ['PRAISE', 'QUESTION_ANSWERABLE'],
      ignoreLabels: dto.ignoreLabels ?? ['SPAM'],
      voiceProfile: dto.voiceProfile ?? null,
      knowledgeSummary: dto.knowledgeSummary ?? null,
      knowledgeUrl: dto.knowledgeUrl ?? null,
      notifyEmails: dto.notifyEmails ?? [],
    };
    if (existing) {
      return this._prisma.model.soulCommentRule.update({ where: { id: existing.id }, data });
    }
    return this._prisma.model.soulCommentRule.create({ data: { organizationId, customerId, ...data } });
  }
}
