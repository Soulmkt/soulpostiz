import { Injectable, Logger } from '@nestjs/common';
import { Integration } from '@prisma/client';
import { SoulCommentsRepository } from '@gitroom/nestjs-libraries/soul/comments/soul.comments.repository';

// Coletor de comentários do Instagram (módulo Comentários, SPTZ-3).
// Lê as mídias recentes de cada canal conectado, compara comments_count com a última
// leitura e só baixa os comentários das mídias que mudaram. Cada comentário novo entra
// em SoulComment com status NEW; resposta da própria conta marca o pai como REPLIED.
// Orçamento da Graph API: ~200 chamadas/hora por usuário. Com leitura a cada 10 min e
// comparação de contagem, uma conta com 30 mídias gasta 1 a 3 chamadas por rodada.

type IgMedia = {
  id: string;
  timestamp: string;
  permalink?: string;
  comments_count?: number;
  caption?: string;
};

type IgComment = {
  id: string;
  text?: string;
  timestamp: string;
  username?: string;
  from?: { id?: string; username?: string };
  like_count?: number;
  replies?: { data: IgComment[] };
};

export type SoulCollectSummary = {
  integrations: number;
  mediaSeen: number;
  mediaFetched: number;
  commentsUpserted: number;
  errors: string[];
};

const GRAPH_VERSION = 'v21.0';

@Injectable()
export class SoulCommentsCollectorService {
  private readonly _logger = new Logger('SoulCommentsCollector');

  constructor(private _repo: SoulCommentsRepository) {}

  async collectAll(): Promise<SoulCollectSummary> {
    const summary: SoulCollectSummary = {
      integrations: 0,
      mediaSeen: 0,
      mediaFetched: 0,
      commentsUpserted: 0,
      errors: [],
    };

    const integrations = await this._repo.listInstagramIntegrations();
    summary.integrations = integrations.length;

    for (const integration of integrations) {
      try {
        await this.collectIntegration(integration, summary);
      } catch (err: any) {
        const msg = `${integration.providerIdentifier}/${integration.profile}: ${err?.message || err}`;
        summary.errors.push(msg);
        this._logger.error(msg);
      }
    }

    this._logger.log(
      `rodada: ${summary.integrations} canais, ${summary.mediaSeen} mídias vistas, ${summary.mediaFetched} lidas, ${summary.commentsUpserted} comentários gravados${
        summary.errors.length ? `, ${summary.errors.length} erros` : ''
      }`
    );
    return summary;
  }

  private hostFor(integration: Integration) {
    return integration.providerIdentifier === 'instagram'
      ? 'graph.facebook.com'
      : 'graph.instagram.com';
  }

  // O provider do Instagram via Facebook guarda "pageToken___userToken"; o standalone
  // guarda só o token. Pra ler mídia e comentários o primeiro serve nos dois casos.
  private tokenFor(integration: Integration) {
    return integration.token.split('___')[0];
  }

  private lookbackMs() {
    const days = Number(process.env.SOUL_COMMENTS_LOOKBACK_DAYS || 30);
    return (isNaN(days) ? 30 : days) * 24 * 60 * 60 * 1000;
  }

  private async graphGet<T>(url: string): Promise<T> {
    const res = await fetch(url);
    const body = await res.text();
    if (!res.ok) {
      throw new Error(`Graph ${res.status}: ${body.slice(0, 300)}`);
    }
    return JSON.parse(body) as T;
  }

  private async listRecentMedia(integration: Integration): Promise<IgMedia[]> {
    const host = this.hostFor(integration);
    const token = this.tokenFor(integration);
    const since = Date.now() - this.lookbackMs();
    const out: IgMedia[] = [];
    let url: string | undefined = `https://${host}/${GRAPH_VERSION}/${integration.internalId}/media?fields=id,timestamp,permalink,comments_count,caption&limit=25&access_token=${token}`;
    let pages = 0;

    while (url && pages < 5) {
      const page = await this.graphGet<{ data: IgMedia[]; paging?: { next?: string } }>(url);
      pages++;
      for (const media of page.data || []) {
        if (new Date(media.timestamp).getTime() < since) {
          return out;
        }
        out.push(media);
      }
      url = page.paging?.next;
    }
    return out;
  }

  private async fetchComments(integration: Integration, mediaId: string): Promise<IgComment[]> {
    const host = this.hostFor(integration);
    const token = this.tokenFor(integration);
    const out: IgComment[] = [];
    let url: string | undefined = `https://${host}/${GRAPH_VERSION}/${mediaId}/comments?fields=id,text,timestamp,username,like_count,replies{id,text,timestamp,username}&limit=50&access_token=${token}`;
    let pages = 0;

    while (url && pages < 4) {
      const page = await this.graphGet<{ data: IgComment[]; paging?: { next?: string } }>(url);
      pages++;
      out.push(...(page.data || []));
      url = page.paging?.next;
    }
    return out;
  }

  private async collectIntegration(integration: Integration, summary: SoulCollectSummary) {
    const medias = await this.listRecentMedia(integration);
    summary.mediaSeen += medias.length;

    for (const media of medias) {
      const count = media.comments_count ?? 0;
      const sync = await this._repo.getMediaSync(integration.id, media.id);
      const changed = !sync || !sync.lastSyncAt || sync.commentsCount !== count;

      // Sem comentário e sem histórico: registra a mídia e segue sem gastar chamada
      if (!changed) {
        continue;
      }

      const post = await this._repo.findPostByReleaseId(integration.id, media.id);
      const publishedAt = media.timestamp ? new Date(media.timestamp) : null;

      if (count > 0) {
        const comments = await this.fetchComments(integration, media.id);
        summary.mediaFetched++;
        for (const comment of comments) {
          summary.commentsUpserted += await this.storeComment(
            integration,
            media,
            comment,
            null,
            post?.id ?? null,
            post?.publishDate ?? publishedAt
          );
        }
      }

      await this._repo.upsertMediaSync({
        organizationId: integration.organizationId,
        integrationId: integration.id,
        externalPostId: media.id,
        postId: post?.id ?? null,
        permalink: media.permalink ?? null,
        caption: media.caption ? media.caption.slice(0, 500) : null,
        publishedAt,
        commentsCount: count,
        lastSyncAt: new Date(),
      });
    }
  }

  // Devolve quantos comentários (de outras pessoas) foram gravados nesta chamada.
  private async storeComment(
    integration: Integration,
    media: IgMedia,
    comment: IgComment,
    parent: IgComment | null,
    postId: string | null,
    postPublishedAt: Date | null
  ): Promise<number> {
    const author = comment.username || comment.from?.username || null;
    const isOwner = !!author && !!integration.profile && author.toLowerCase() === integration.profile.toLowerCase();
    let stored = 0;

    if (isOwner) {
      // Resposta nossa a um comentário de terceiro: marca o pai como respondido
      if (parent) {
        await this._repo.markRepliedByOwner(
          parent.id,
          comment.id,
          new Date(comment.timestamp),
          comment.text || ''
        );
      }
    } else {
      await this._repo.upsertComment({
        organizationId: integration.organizationId,
        integrationId: integration.id,
        postId,
        externalPostId: media.id,
        externalCommentId: comment.id,
        parentExternalId: parent?.id ?? null,
        authorUsername: author,
        authorId: comment.from?.id ?? null,
        text: comment.text || '',
        commentedAt: new Date(comment.timestamp),
        postPublishedAt,
        raw: { ...comment, replies: undefined } as any,
      });
      stored++;
    }

    for (const reply of comment.replies?.data || []) {
      stored += await this.storeComment(integration, media, reply, comment, postId, postPublishedAt);
    }
    return stored;
  }
}
