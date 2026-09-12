import { Injectable } from '@nestjs/common';
import { PrismaRepository } from '@gitroom/nestjs-libraries/database/prisma/prisma.service';
import { Prisma, SoulCommentStatus } from '@prisma/client';

// Providers do Instagram que o coletor entende. Os dois usam a Graph API com o mesmo
// formato de mídia/comentários; muda só o host e a forma do token.
export const SOUL_INSTAGRAM_PROVIDERS = ['instagram-standalone', 'instagram'];

@Injectable()
export class SoulCommentsRepository {
  constructor(
    private _prisma: PrismaRepository<
      'soulComment' | 'soulMediaSync' | 'integration' | 'post'
    >
  ) {}

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

  countByStatus(organizationId: string) {
    return this._prisma.model.soulComment.groupBy({
      by: ['status'],
      where: { organizationId },
      _count: { _all: true },
    });
  }

  listByStatus(
    organizationId: string,
    status: SoulCommentStatus,
    take = 50
  ) {
    return this._prisma.model.soulComment.findMany({
      where: { organizationId, status },
      orderBy: { commentedAt: 'desc' },
      take,
    });
  }
}
