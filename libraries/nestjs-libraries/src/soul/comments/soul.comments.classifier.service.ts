import { Injectable, Logger } from '@nestjs/common';
import { SoulComment, SoulCommentMode, SoulCommentRule, SoulCommentStatus } from '@prisma/client';
import { SoulCommentsRepository } from '@gitroom/nestjs-libraries/soul/comments/soul.comments.repository';

// Classificador de comentários (SPTZ-4).
// Rótulos fixos; a decisão (responder sozinho, segurar na fila, ignorar) vem da regra do
// Customer. Usa Anthropic (ANTHROPIC_API_KEY) ou OpenAI (OPENAI_API_KEY); sem chave, cai numa
// heurística conservadora que só automatiza elogio/emoji óbvio e manda o resto pra fila.

export const SOUL_LABELS = [
  'PRAISE', // elogio, emoji, agradecimento, "que lindo", "amei"
  'QUESTION_ANSWERABLE', // pergunta cuja resposta está no post/legenda/site (onde, qual espécie, quando)
  'QUESTION_UNSURE', // pergunta que exige conhecimento ou opinião fora do conteúdo
  'CRITICISM', // crítica, reclamação, correção de identificação, tom negativo
  'MENTION', // marca outra pessoa, conversa entre terceiros
  'CONTACT_REQUEST', // pedido de contato, orçamento, parceria, venda
  'SPAM', // propaganda, link suspeito, golpe, texto sem relação
  'OTHER',
] as const;
export type SoulLabel = (typeof SOUL_LABELS)[number];

export const DEFAULT_AUTO_LABELS: SoulLabel[] = ['PRAISE', 'QUESTION_ANSWERABLE'];
export const DEFAULT_IGNORE_LABELS: SoulLabel[] = ['SPAM'];

type Classification = { label: SoulLabel; confidence: number; reason: string; engine: string };

const PRAISE_WORDS = /\b(lind[oa]s?|amei|maravilh|incr[ií]vel|perfeit|top|parab[eé]ns|que foto|sensacional|demais|show|arras|obrigad|gratid|espetac|belíssim|belissim|encant)/i;
const EMOJI_ONLY = /^[\s\p{Extended_Pictographic}\p{Emoji_Presentation}\p{Emoji_Modifier}‍️!.]+$/u;
const SPAM_HINT = /(https?:\/\/|www\.|bit\.ly|promo[cç][aã]o|ganhe|renda extra|dm me|whats(app)?\s*\+?\d|siga de volta|follow back|crypto|invest)/i;
const CONTACT_HINT = /(or[cç]amento|parceria|comprar|vende|pre[cç]o|contato|e-?mail|chama no|manda no|direct|publi)/i;
const CRITIC_HINT = /(errad|n[aã]o [eé]|mentira|fake|absurd|horr[ií]vel|p[eé]ssim|ruim|falso|na verdade [eé]|isso [eé] um|isso n[aã]o [eé])/i;
const MENTION_ONLY = /^\s*(@[\w.]+\s*)+[\s!.]*$/;
const ANSWERABLE_HINT = /(onde (foi|fica|[eé])|qual (esp[eé]cie|bicho|planta|nome|lugar)|que (bicho|planta|esp[eé]cie|lugar)|em que (lugar|[eé]poca)|quando)/i;

@Injectable()
export class SoulCommentsClassifierService {
  private readonly _logger = new Logger('SoulCommentsClassifier');

  constructor(private _repo: SoulCommentsRepository) {}

  // Classifica os comentários NEW e aplica a regra do Customer. Devolve um resumo.
  async classifyNew(limit = 50) {
    const pending = await this._repo.listNewForClassification(limit);
    const summary = { classified: 0, auto: 0, queued: 0, ignored: 0, left: 0, engine: this.engineName() };

    for (const comment of pending) {
      try {
        const rule = await this._repo.getEffectiveRule(comment.organizationId, comment.integrationId);
        if (rule.mode === SoulCommentMode.OFF) {
          summary.left++;
          continue;
        }

        const result = await this.classify(comment.text, comment.authorUsername || '', rule);
        const status = this.decide(result.label, rule);
        await this._repo.applyClassification(comment.id, {
          classification: result.label,
          classificationConfidence: result.confidence,
          classificationReason: `${result.engine}: ${result.reason}`.slice(0, 500),
          status,
        });
        summary.classified++;
        if (status === SoulCommentStatus.AUTO_PENDING) summary.auto++;
        else if (status === SoulCommentStatus.QUEUED) summary.queued++;
        else if (status === SoulCommentStatus.IGNORED) summary.ignored++;
      } catch (err: any) {
        this._logger.error(`comentário ${comment.externalCommentId}: ${err?.message || err}`);
        summary.left++;
      }
    }

    if (pending.length) {
      this._logger.log(
        `classificação (${summary.engine}): ${summary.classified} de ${pending.length}; automático ${summary.auto}, fila ${summary.queued}, ignorado ${summary.ignored}`
      );
    }
    return summary;
  }

  decide(label: SoulLabel, rule: SoulCommentRule): SoulCommentStatus {
    const ignore = ((rule.ignoreLabels as string[]) || DEFAULT_IGNORE_LABELS).includes(label);
    if (ignore) return SoulCommentStatus.IGNORED;
    if (rule.mode === SoulCommentMode.REVIEW_ALL) return SoulCommentStatus.QUEUED;
    const auto = ((rule.autoLabels as string[]) || DEFAULT_AUTO_LABELS).includes(label);
    return auto ? SoulCommentStatus.AUTO_PENDING : SoulCommentStatus.QUEUED;
  }

  engineName() {
    if (process.env.ANTHROPIC_API_KEY) return `anthropic/${process.env.SOUL_CLASSIFIER_MODEL || 'claude-haiku-4-5-20251001'}`;
    if (process.env.OPENAI_API_KEY) return `openai/${process.env.SOUL_CLASSIFIER_MODEL || 'gpt-4.1-mini'}`;
    return 'heuristica';
  }

  async classify(text: string, author: string, rule: SoulCommentRule): Promise<Classification> {
    const heuristic = this.heuristic(text);
    // Casos óbvios não gastam IA: emoji puro, elogio curto, spam com link, só menção
    if (heuristic.confidence >= 0.9) return heuristic;

    try {
      if (process.env.ANTHROPIC_API_KEY) return await this.classifyAnthropic(text, author, rule);
      if (process.env.OPENAI_API_KEY) return await this.classifyOpenAI(text, author, rule);
    } catch (err: any) {
      this._logger.warn(`IA falhou, usando heurística: ${err?.message || err}`);
    }
    return heuristic;
  }

  heuristic(raw: string): Classification {
    const text = (raw || '').trim();
    const engine = 'heuristica';
    if (!text) return { label: 'OTHER', confidence: 0.5, reason: 'vazio', engine };
    if (SPAM_HINT.test(text)) return { label: 'SPAM', confidence: 0.9, reason: 'link ou termo de propaganda', engine };
    if (EMOJI_ONLY.test(text)) return { label: 'PRAISE', confidence: 0.95, reason: 'só emoji', engine };
    if (MENTION_ONLY.test(text)) return { label: 'MENTION', confidence: 0.95, reason: 'só marcação', engine };
    if (CONTACT_HINT.test(text)) return { label: 'CONTACT_REQUEST', confidence: 0.7, reason: 'termo de contato/comercial', engine };
    if (CRITIC_HINT.test(text)) return { label: 'CRITICISM', confidence: 0.7, reason: 'termo negativo ou correção', engine };
    if (text.includes('?')) {
      return ANSWERABLE_HINT.test(text)
        ? { label: 'QUESTION_ANSWERABLE', confidence: 0.6, reason: 'pergunta sobre onde/qual/quando', engine }
        : { label: 'QUESTION_UNSURE', confidence: 0.6, reason: 'pergunta', engine };
    }
    if (PRAISE_WORDS.test(text) && text.length <= 120) return { label: 'PRAISE', confidence: 0.9, reason: 'palavra de elogio, texto curto', engine };
    return { label: 'OTHER', confidence: 0.4, reason: 'sem sinal claro', engine };
  }

  private prompt(text: string, author: string, rule: SoulCommentRule) {
    const context = rule.knowledgeSummary ? `\nContexto do perfil: ${rule.knowledgeSummary}\n` : '';
    return `Você classifica comentários recebidos em posts do Instagram de um perfil.${context}
Rótulos possíveis (responda só com JSON {"label":..., "confidence": 0..1, "reason": "curto"}):
- PRAISE: elogio, emoji, agradecimento, reação positiva sem pergunta.
- QUESTION_ANSWERABLE: pergunta cuja resposta está no próprio post ou no site do perfil (onde foi, qual espécie, quando, onde ver mais).
- QUESTION_UNSURE: pergunta que exige conhecimento externo, opinião ou dado que o perfil talvez não tenha.
- CRITICISM: crítica, reclamação, correção, tom negativo ou irônico.
- MENTION: só marca outra pessoa ou conversa com terceiro.
- CONTACT_REQUEST: pedido de contato, orçamento, parceria, compra, publicidade.
- SPAM: propaganda, link, golpe, texto sem relação.
- OTHER: nada acima.
Na dúvida entre automático e revisão humana, prefira o rótulo que leva à revisão (QUESTION_UNSURE, CRITICISM, OTHER).

Autor: @${author || 'desconhecido'}
Comentário: """${text.slice(0, 1000)}"""`;
  }

  private parse(raw: string, engine: string): Classification {
    const m = raw.match(/\{[\s\S]*\}/);
    const json = m ? JSON.parse(m[0]) : {};
    const label = (SOUL_LABELS as readonly string[]).includes(json.label) ? (json.label as SoulLabel) : 'OTHER';
    const confidence = Math.max(0, Math.min(1, Number(json.confidence ?? 0.5)));
    return { label, confidence, reason: String(json.reason || '').slice(0, 200), engine };
  }

  private async classifyAnthropic(text: string, author: string, rule: SoulCommentRule): Promise<Classification> {
    const model = process.env.SOUL_CLASSIFIER_MODEL || 'claude-haiku-4-5-20251001';
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY!,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model,
        max_tokens: 150,
        temperature: 0,
        messages: [{ role: 'user', content: this.prompt(text, author, rule) }],
      }),
    });
    if (!res.ok) throw new Error(`anthropic ${res.status}: ${(await res.text()).slice(0, 200)}`);
    const data = (await res.json()) as { content: { type: string; text?: string }[] };
    const out = data.content?.map((c) => c.text || '').join('') || '';
    return this.parse(out, `anthropic/${model}`);
  }

  private async classifyOpenAI(text: string, author: string, rule: SoulCommentRule): Promise<Classification> {
    const model = process.env.SOUL_CLASSIFIER_MODEL || 'gpt-4.1-mini';
    const res = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${process.env.OPENAI_API_KEY}` },
      body: JSON.stringify({
        model,
        temperature: 0,
        max_tokens: 150,
        messages: [{ role: 'user', content: this.prompt(text, author, rule) }],
      }),
    });
    if (!res.ok) throw new Error(`openai ${res.status}: ${(await res.text()).slice(0, 200)}`);
    const data = (await res.json()) as { choices: { message: { content: string } }[] };
    return this.parse(data.choices?.[0]?.message?.content || '', `openai/${model}`);
  }
}

// Só pra manter o tipo exportado junto do serviço (a tela usa)
export type { SoulComment };
