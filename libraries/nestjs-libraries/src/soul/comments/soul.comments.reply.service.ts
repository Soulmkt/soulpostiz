import { Injectable, Logger } from '@nestjs/common';
import { Integration, SoulComment, SoulCommentRule, SoulCommentStatus } from '@prisma/client';
import { SoulCommentsRepository } from '@gitroom/nestjs-libraries/soul/comments/soul.comments.repository';

// Resposta automática (SPTZ-5).
// Fluxo: AUTO_PENDING → gera texto na voz do Customer → REPLY_READY → publica na Graph API →
// AUTO_REPLIED. Com SOUL_REPLY_DRY_RUN=true para em REPLY_READY (texto pronto, sem publicar).
// Falha de publicação: registra o erro, tenta até 3 vezes em voltas seguintes e depois manda
// pra fila (QUEUED) com o texto já gerado, pra alguém decidir.

const GRAPH_VERSION = 'v21.0';
const MAX_ATTEMPTS = 3;
const MAX_LEN = 280;

// Modelos sem IA (fallback). Regras do Gilmar (13/09/2026): primeira pessoa, curto, agradece
// o que a pessoa disse, NÃO presume o que é o post (pode ser apresentação, calendário,
// ecossistema, espécie ou história) e NUNCA termina em pergunta.
const PRAISE_TEMPLATES = [
  'Muito obrigado! Fico feliz que tenha gostado.',
  'Obrigado! Isso me anima a continuar mostrando o que vive por aqui.',
  'Valeu demais! Tem muito mais no site, link na bio.',
  'Obrigado pelo carinho! Vem mais por aí.',
  'Que bom que gostou, obrigado!',
];

type Generated = { text: string; engine: string };

@Injectable()
export class SoulCommentsReplyService {
  private readonly _logger = new Logger('SoulCommentsReply');

  constructor(private _repo: SoulCommentsRepository) {}

  dryRun() {
    return process.env.SOUL_REPLY_DRY_RUN === 'true';
  }

  engineName() {
    if (process.env.ANTHROPIC_API_KEY) return `anthropic/${process.env.SOUL_REPLY_MODEL || process.env.SOUL_CLASSIFIER_MODEL || 'claude-haiku-4-5-20251001'}`;
    if (process.env.OPENAI_API_KEY) return `openai/${process.env.SOUL_REPLY_MODEL || process.env.SOUL_CLASSIFIER_MODEL || 'gpt-4.1-mini'}`;
    return 'modelo';
  }

  // Passo 1: gera texto pra tudo que está AUTO_PENDING. Passo 2: publica o que está REPLY_READY.
  async processAutoPending(limit = 50) {
    const summary = { generated: 0, published: 0, failed: 0, queued: 0, dryRun: this.dryRun(), engine: this.engineName() };

    for (const comment of await this._repo.listByStatusAll(SoulCommentStatus.AUTO_PENDING, limit)) {
      try {
        const rule = await this._repo.getEffectiveRule(comment.organizationId, comment.integrationId);
        // Sem IA, só elogio ganha modelo pronto; pergunta vai pra revisão humana (feedback Gilmar 13/09)
        if (!this.hasAi() && comment.classification !== 'PRAISE') {
          await this._repo.setReplyError(comment.id, 'sem IA configurada: pergunta vai pra revisão humana', true);
          summary.queued++;
          continue;
        }
        const media = await this._repo.getMediaSync(comment.integrationId, comment.externalPostId);
        const gen = await this.generate(comment, rule, media?.caption || null, media?.permalink || null);
        await this._repo.setReplyDraft(comment.id, gen.text, gen.engine);
        summary.generated++;
      } catch (err: any) {
        this._logger.error(`gerar ${comment.externalCommentId}: ${err?.message || err}`);
      }
    }

    if (!this.dryRun()) {
      for (const comment of await this._repo.listByStatusAll(SoulCommentStatus.REPLY_READY, limit)) {
        const r = await this.publish(comment);
        if (r === 'ok') summary.published++;
        else if (r === 'queued') summary.queued++;
        else summary.failed++;
      }
    }

    if (summary.generated || summary.published || summary.failed) {
      this._logger.log(
        `respostas (${summary.engine}${summary.dryRun ? ', dry-run' : ''}): ${summary.generated} geradas, ${summary.published} publicadas, ${summary.failed} falhas, ${summary.queued} pra fila`
      );
    }
    return summary;
  }

  // Publica uma resposta já pronta (usado pelo loop e pela ação manual da tela)
  async publish(comment: SoulComment, textOverride?: string): Promise<'ok' | 'retry' | 'queued'> {
    const text = (textOverride || comment.replyText || '').trim();
    if (!text) {
      await this._repo.setReplyError(comment.id, 'sem texto de resposta', true);
      return 'queued';
    }
    const integration = await this._repo.getIntegration(comment.integrationId);
    if (!integration) {
      await this._repo.setReplyError(comment.id, 'canal não encontrado', true);
      return 'queued';
    }

    try {
      const replyId = await this.graphReply(integration, comment.externalCommentId, text);
      await this._repo.setReplied(comment.id, text, replyId);
      return 'ok';
    } catch (err: any) {
      const attempts = (comment.replyAttempts ?? 0) + 1;
      const giveUp = attempts >= MAX_ATTEMPTS;
      await this._repo.setReplyError(comment.id, String(err?.message || err).slice(0, 400), giveUp, attempts);
      this._logger.warn(`publicar ${comment.externalCommentId} (tentativa ${attempts}): ${err?.message || err}`);
      return giveUp ? 'queued' : 'retry';
    }
  }

  private hostFor(integration: Integration) {
    return integration.providerIdentifier === 'instagram' ? 'graph.facebook.com' : 'graph.instagram.com';
  }

  private async graphReply(integration: Integration, commentId: string, message: string): Promise<string> {
    const token = integration.token.split('___')[0];
    const res = await fetch(`https://${this.hostFor(integration)}/${GRAPH_VERSION}/${commentId}/replies`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ message, access_token: token }).toString(),
    });
    const body = await res.text();
    if (!res.ok) throw new Error(`Graph ${res.status}: ${body.slice(0, 300)}`);
    const json = JSON.parse(body) as { id?: string };
    if (!json.id) throw new Error(`Graph sem id: ${body.slice(0, 200)}`);
    return json.id;
  }

  // ---------- geração ----------

  hasAi() {
    return !!(process.env.ANTHROPIC_API_KEY || process.env.OPENAI_API_KEY);
  }

  async generate(comment: SoulComment, rule: SoulCommentRule, caption: string | null, permalink: string | null): Promise<Generated> {
    const fallback = this.template(comment);
    try {
      if (process.env.ANTHROPIC_API_KEY) return await this.generateAnthropic(comment, rule, caption, permalink);
      if (process.env.OPENAI_API_KEY) return await this.generateOpenAI(comment, rule, caption, permalink);
    } catch (err: any) {
      this._logger.warn(`IA falhou, usando modelo pronto: ${err?.message || err}`);
    }
    return fallback;
  }

  private template(comment: SoulComment): Generated {
    const list = PRAISE_TEMPLATES;
    // variação determinística por comentário, pra não repetir a mesma frase em sequência
    let h = 0;
    for (const ch of comment.externalCommentId) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
    return { text: list[h % list.length], engine: 'modelo' };
  }

  private prompt(comment: SoulComment, rule: SoulCommentRule, caption: string | null, permalink: string | null) {
    return `Você responde comentários no Instagram em nome do dono do perfil. Escreva a resposta final, em português do Brasil, sem aspas, sem explicação.

Voz do perfil:
${rule.voiceProfile || 'Primeira pessoa, curto, cordial, sem gíria forçada, sem citar nome de pessoa, sem travessão, sem pergunta no fim.'}

Sobre o perfil e as fontes:
${rule.knowledgeSummary || '(sem resumo cadastrado)'}

Regras:
- Até ${MAX_LEN} caracteres, uma ou duas frases.
- Primeira pessoa. Nunca citar nome de pessoa nem @ de terceiros.
- Nunca use travessão.
- NUNCA termine com pergunta. Nenhuma pergunta na resposta.
- Leia a legenda antes: o post pode ser a apresentação do projeto, um calendário, um ecossistema, uma espécie ou uma história. Não presuma que é uma foto de bicho nem diga "essa eu fotografei" a menos que a legenda deixe claro.
- Se for elogio: agradeça de forma específica ao que a pessoa disse, em uma frase, e no máximo mais uma frase ligada ao conteúdo do post.
- Se for pergunta respondível: responda direto com o que está na legenda; se faltar detalhe, aponte o site (link na bio) sem inventar dado.
- Não prometa nada, não peça follow, não use hashtag, no máximo um emoji.

Post (legenda): """${(caption || '').slice(0, 1200)}"""
${permalink ? `Link do post: ${permalink}` : ''}
Rótulo do comentário: ${comment.classification}
Comentário de @${comment.authorUsername || 'alguem'}: """${comment.text.slice(0, 600)}"""

Resposta:`;
  }

  private clean(text: string) {
    return text.replace(/^["“]|["”]$/g, '').replace(/—/g, ',').trim().slice(0, MAX_LEN);
  }

  private async generateAnthropic(comment: SoulComment, rule: SoulCommentRule, caption: string | null, permalink: string | null): Promise<Generated> {
    const model = process.env.SOUL_REPLY_MODEL || process.env.SOUL_CLASSIFIER_MODEL || 'claude-haiku-4-5-20251001';
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-api-key': process.env.ANTHROPIC_API_KEY!, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({ model, max_tokens: 200, temperature: 0.7, messages: [{ role: 'user', content: this.prompt(comment, rule, caption, permalink) }] }),
    });
    if (!res.ok) throw new Error(`anthropic ${res.status}: ${(await res.text()).slice(0, 200)}`);
    const data = (await res.json()) as { content: { text?: string }[] };
    return { text: this.clean(data.content?.map((c) => c.text || '').join('') || ''), engine: `anthropic/${model}` };
  }

  private async generateOpenAI(comment: SoulComment, rule: SoulCommentRule, caption: string | null, permalink: string | null): Promise<Generated> {
    const model = process.env.SOUL_REPLY_MODEL || process.env.SOUL_CLASSIFIER_MODEL || 'gpt-4.1-mini';
    const res = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${process.env.OPENAI_API_KEY}` },
      body: JSON.stringify({ model, temperature: 0.7, max_tokens: 200, messages: [{ role: 'user', content: this.prompt(comment, rule, caption, permalink) }] }),
    });
    if (!res.ok) throw new Error(`openai ${res.status}: ${(await res.text()).slice(0, 200)}`);
    const data = (await res.json()) as { choices: { message: { content: string } }[] };
    return { text: this.clean(data.choices?.[0]?.message?.content || ''), engine: `openai/${model}` };
  }
}
