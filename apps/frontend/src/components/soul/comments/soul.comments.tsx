'use client';

// Tela Comentários (soulpostiz, SPTZ-6). Fila por urgência, texto sugerido ao lado de cada
// comentário, aprovar / editar / responder / descartar, histórico e regras por Customer.
// Textos em pt-BR direto (convenção do fork). Sem travessão.

import { FC, useCallback, useMemo, useState } from 'react';
import useSWR from 'swr';
import clsx from 'clsx';
import dayjs from 'dayjs';
import { useFetch } from '@gitroom/helpers/utils/custom.fetch';
import { Button } from '@gitroom/react/form/button';
import { useToaster } from '@gitroom/react/toaster/toaster';

type Status = 'QUEUED' | 'REPLY_READY' | 'AUTO_PENDING' | 'NEW' | 'AUTO_REPLIED' | 'REPLIED' | 'IGNORED' | 'SKIPPED';

type Comment = {
  id: string;
  integrationId: string;
  externalPostId: string;
  externalCommentId: string;
  authorUsername?: string | null;
  text: string;
  commentedAt: string;
  postPublishedAt?: string | null;
  status: Status;
  classification?: string | null;
  classificationReason?: string | null;
  replyText?: string | null;
  replyEngine?: string | null;
  replyError?: string | null;
  repliedAt?: string | null;
  media?: { permalink?: string | null; caption?: string | null } | null;
};

type Rule = {
  id: string;
  customerId: string | null;
  mode: 'AUTO' | 'REVIEW_ALL' | 'OFF';
  autoLabels: string[];
  ignoreLabels: string[];
  voiceProfile?: string | null;
  knowledgeSummary?: string | null;
  knowledgeUrl?: string | null;
  notifyEmails?: string[];
};

type Summary = {
  byStatus: { status: Status; _count: { _all: number } }[];
  engine: string;
  replyEngine: string;
  replyDryRun: boolean;
};

const TABS: { key: Status; label: string; hint: string }[] = [
  { key: 'QUEUED', label: 'Fila', hint: 'precisa de você: crítica, dúvida, contato ou pergunta sem resposta segura' },
  { key: 'REPLY_READY', label: 'Prontas', hint: 'texto gerado, aguardando publicação (ou dry-run)' },
  { key: 'AUTO_REPLIED', label: 'Automáticas', hint: 'respondidas pelo módulo' },
  { key: 'REPLIED', label: 'Respondidas no app', hint: 'a própria conta respondeu pelo Instagram' },
  { key: 'IGNORED', label: 'Ignoradas', hint: 'spam ou descartadas' },
  { key: 'NEW', label: 'Novas', hint: 'coletadas, ainda não classificadas' },
];

const LABEL_PT: Record<string, string> = {
  PRAISE: 'elogio',
  QUESTION_ANSWERABLE: 'pergunta respondível',
  QUESTION_UNSURE: 'pergunta incerta',
  CRITICISM: 'crítica',
  MENTION: 'menção',
  CONTACT_REQUEST: 'pedido de contato',
  SPAM: 'spam',
  OTHER: 'outro',
};

const MODE_PT: Record<Rule['mode'], string> = {
  AUTO: 'Automático com exceções',
  REVIEW_ALL: 'Tudo com aprovação',
  OFF: 'Desligado',
};

const minutesBetween = (a?: string | null, b?: string | null) =>
  a && b ? Math.round((dayjs(b).valueOf() - dayjs(a).valueOf()) / 60000) : null;

const ago = (iso: string) => {
  const m = Math.max(0, Math.round((Date.now() - dayjs(iso).valueOf()) / 60000));
  if (m < 60) return `há ${m} min`;
  if (m < 60 * 24) return `há ${Math.round(m / 60)} h`;
  return dayjs(iso).format('DD/MM HH:mm');
};

export const SoulComments: FC = () => {
  const fetch = useFetch();
  const toaster = useToaster();
  const [tab, setTab] = useState<Status>('QUEUED');
  const [showRules, setShowRules] = useState(false);

  const load = useCallback(async (path: string) => (await fetch(path)).json(), [fetch]);

  const { data: summary, mutate: reloadSummary } = useSWR<Summary>('soul-comments-summary', () => load('/soul/comments/summary'));
  const { data: list, isLoading, mutate: reloadList } = useSWR<Comment[]>(`soul-comments-${tab}`, () =>
    load(`/soul/comments?status=${tab}&take=100`)
  );
  const { data: rules, mutate: reloadRules } = useSWR<Rule[]>('soul-comments-rules', () => load('/soul/comments/rules'));
  const { data: integrations } = useSWR<any[]>('soul-integrations', async () => (await load('/integrations/list')).integrations || []);

  const counts = useMemo(() => {
    const m: Partial<Record<Status, number>> = {};
    for (const row of summary?.byStatus || []) m[row.status] = row._count._all;
    return m;
  }, [summary]);

  const refresh = useCallback(async () => {
    await Promise.all([reloadList(), reloadSummary()]);
  }, [reloadList, reloadSummary]);

  const post = useCallback(
    async (path: string, body?: any) => {
      const res = await fetch(path, { method: 'POST', body: body ? JSON.stringify(body) : undefined });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return res.json();
    },
    [fetch]
  );

  const runNow = useCallback(async () => {
    try {
      const r = await post('/soul/comments/run');
      toaster.show(
        `Coleta: ${r.collect?.commentsUpserted ?? 0} novos. Classificação: ${r.classify?.classified ?? 0}. Respostas: ${r.reply?.generated ?? 0} geradas, ${r.reply?.published ?? 0} publicadas.`,
        'success'
      );
      await refresh();
    } catch (e: any) {
      toaster.show(`Falhou: ${e?.message || e}`, 'warning');
    }
  }, [post, refresh, toaster]);

  return (
    <div className="flex flex-col gap-[16px] flex-1">
      <div className="bg-newBgColorInner rounded-[12px] p-[20px] flex flex-wrap items-center gap-[12px]">
        <div className="flex-1 min-w-[240px]">
          <div className="text-[18px] font-[600]">Comentários</div>
          <div className="text-[13px] opacity-70">
            Coleta a cada 10 min. Classificador: {summary?.engine || '...'}. Respostas: {summary?.replyEngine || '...'}
            {summary?.replyDryRun ? ' (modo teste: gera o texto, não publica)' : ''}.
          </div>
        </div>
        <Button secondary onClick={() => setShowRules((v) => !v)}>
          {showRules ? 'Fechar regras' : 'Regras por cliente'}
        </Button>
        <Button onClick={runNow}>Rodar agora</Button>
      </div>

      {showRules && (
        <RulesEditor rules={rules || []} integrations={integrations || []} onSaved={() => reloadRules()} />
      )}

      <div className="flex gap-[6px] flex-wrap">
        {TABS.map((tItem) => (
          <button
            key={tItem.key}
            title={tItem.hint}
            onClick={() => setTab(tItem.key)}
            className={clsx(
              'px-[14px] py-[8px] rounded-[10px] text-[13px] font-[600] transition-colors',
              tab === tItem.key ? 'bg-primary text-white' : 'bg-newBgColorInner hover:bg-boxHover'
            )}
          >
            {tItem.label}
            <span className="ml-[6px] opacity-70">{counts[tItem.key] ?? 0}</span>
          </button>
        ))}
      </div>

      <div className="flex flex-col gap-[10px]">
        {isLoading && <div className="opacity-70 text-[13px]">Carregando...</div>}
        {!isLoading && !list?.length && (
          <div className="bg-newBgColorInner rounded-[12px] p-[24px] text-center opacity-70">
            Nada aqui por enquanto.
          </div>
        )}
        {list?.map((c) => (
          <CommentCard key={c.id} comment={c} onChanged={refresh} post={post} />
        ))}
      </div>
    </div>
  );
};

const CommentCard: FC<{
  comment: Comment;
  onChanged: () => Promise<void>;
  post: (path: string, body?: any) => Promise<any>;
}> = ({ comment, onChanged, post }) => {
  const toaster = useToaster();
  const [text, setText] = useState(comment.replyText || '');
  const [busy, setBusy] = useState<string | null>(null);

  const sinceCommentMin = Math.round((Date.now() - dayjs(comment.commentedAt).valueOf()) / 60000);
  const afterPostMin = minutesBetween(comment.postPublishedAt, comment.commentedAt);
  const urgent = comment.status === 'QUEUED' && sinceCommentMin <= 60;
  const closed = ['AUTO_REPLIED', 'REPLIED', 'IGNORED', 'SKIPPED'].includes(comment.status);

  const act = useCallback(
    async (label: string, fn: () => Promise<any>, ok: string) => {
      setBusy(label);
      try {
        await fn();
        toaster.show(ok, 'success');
        await onChanged();
      } catch (e: any) {
        toaster.show(`Falhou: ${e?.message || e}`, 'warning');
      } finally {
        setBusy(null);
      }
    },
    [onChanged, toaster]
  );

  return (
    <div className={clsx('bg-newBgColorInner rounded-[12px] p-[16px] flex flex-col gap-[10px] border', urgent ? 'border-primary' : 'border-transparent')}>
      <div className="flex flex-wrap items-center gap-[8px] text-[12px] opacity-80">
        <span className="font-[600] opacity-100">@{comment.authorUsername || 'desconhecido'}</span>
        <span>{ago(comment.commentedAt)}</span>
        {afterPostMin !== null && <span>· {afterPostMin} min depois do post</span>}
        {urgent && <span className="px-[8px] py-[2px] rounded-[6px] bg-primary text-white">dentro da 1ª hora</span>}
        {comment.classification && (
          <span className="px-[8px] py-[2px] rounded-[6px] bg-boxHover" title={comment.classificationReason || ''}>
            {LABEL_PT[comment.classification] || comment.classification}
          </span>
        )}
        {comment.media?.permalink && (
          <a className="underline" href={comment.media.permalink} target="_blank" rel="noreferrer">
            ver post
          </a>
        )}
      </div>

      <div className="text-[15px] whitespace-pre-wrap">{comment.text}</div>

      {comment.media?.caption && (
        <div className="text-[12px] opacity-60 line-clamp-2" title={comment.media.caption}>
          Post: {comment.media.caption}
        </div>
      )}

      {closed ? (
        <div className="text-[13px] opacity-80">
          {comment.status === 'IGNORED' && 'Ignorado.'}
          {(comment.status === 'AUTO_REPLIED' || comment.status === 'REPLIED') && (
            <>
              <span className="font-[600]">Resposta{comment.status === 'AUTO_REPLIED' ? ' automática' : ' (pelo app)'}:</span> {comment.replyText || '(sem texto)'}
              {comment.repliedAt && <span className="opacity-60"> · {dayjs(comment.repliedAt).format('DD/MM HH:mm')}</span>}
            </>
          )}
        </div>
      ) : (
        <>
          <textarea
            className="w-full min-h-[70px] rounded-[8px] p-[10px] text-[14px] bg-boxHover outline-none"
            placeholder="Escreva a resposta ou gere uma sugestão"
            value={text}
            onChange={(e) => setText(e.target.value)}
          />
          {comment.replyError && <div className="text-[12px] text-red">Última tentativa: {comment.replyError}</div>}
          <div className="flex flex-wrap gap-[8px]">
            <Button
              loading={busy === 'reply'}
              disabled={!text.trim()}
              onClick={() => act('reply', () => post(`/soul/comments/${comment.id}/reply`, { text }), 'Resposta enviada')}
            >
              Responder agora
            </Button>
            <Button
              secondary
              loading={busy === 'gen'}
              onClick={() =>
                act('gen', async () => {
                  const r = await post(`/soul/comments/${comment.id}/regenerate`);
                  if (r?.replyText) setText(r.replyText);
                }, 'Sugestão gerada')
              }
            >
              Gerar sugestão
            </Button>
            {comment.status === 'QUEUED' && (
              <Button
                secondary
                loading={busy === 'auto'}
                onClick={() => act('auto', () => post(`/soul/comments/${comment.id}/status`, { status: 'AUTO_PENDING' }), 'Liberado pro automático')}
              >
                Deixar o automático responder
              </Button>
            )}
            <Button
              secondary
              loading={busy === 'ignore'}
              onClick={() => act('ignore', () => post(`/soul/comments/${comment.id}/status`, { status: 'IGNORED' }), 'Descartado')}
            >
              Descartar
            </Button>
          </div>
        </>
      )}
    </div>
  );
};

const RulesEditor: FC<{ rules: Rule[]; integrations: any[]; onSaved: () => void }> = ({ rules, integrations, onSaved }) => {
  const fetch = useFetch();
  const toaster = useToaster();

  // Customers conhecidos: os dos canais + os que já têm regra
  const customers = useMemo(() => {
    const map = new Map<string | null, string>();
    map.set(null, 'Padrão da organização');
    for (const i of integrations) {
      if (i?.customer?.id) map.set(i.customer.id, i.customer.name || i.customer.id);
    }
    for (const r of rules) if (r.customerId && !map.has(r.customerId)) map.set(r.customerId, r.customerId);
    return [...map.entries()];
  }, [integrations, rules]);

  return (
    <div className="bg-newBgColorInner rounded-[12px] p-[20px] flex flex-col gap-[16px]">
      <div className="text-[15px] font-[600]">Regras por cliente</div>
      <div className="text-[13px] opacity-70">
        Automático com exceções: elogio e pergunta respondível são respondidos sozinhos; crítica, dúvida, contato e menção vão pra fila; spam é ignorado.
        Tudo com aprovação: nada sai sem você. Sem regra cadastrada, vale "tudo com aprovação".
      </div>
      {customers.map(([customerId, name]) => (
        <RuleRow
          key={customerId || 'org'}
          customerId={customerId}
          name={name}
          rule={rules.find((r) => (r.customerId || null) === customerId)}
          save={async (body) => {
            const res = await fetch('/soul/comments/rules', { method: 'PUT', body: JSON.stringify(body) });
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            toaster.show('Regra salva', 'success');
            onSaved();
          }}
        />
      ))}
    </div>
  );
};

const RuleRow: FC<{ customerId: string | null; name: string; rule?: Rule; save: (body: any) => Promise<void> }> = ({ customerId, name, rule, save }) => {
  const [mode, setMode] = useState<Rule['mode']>(rule?.mode || 'REVIEW_ALL');
  const [voice, setVoice] = useState(rule?.voiceProfile || '');
  const [knowledge, setKnowledge] = useState(rule?.knowledgeSummary || '');
  const [emails, setEmails] = useState((rule?.notifyEmails || []).join(', '));
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  return (
    <div className="border border-boxHover rounded-[10px] p-[14px] flex flex-col gap-[10px]">
      <div className="flex flex-wrap items-center gap-[10px]">
        <div className="font-[600] flex-1 min-w-[160px]">{name}</div>
        <select className="rounded-[8px] p-[8px] bg-boxHover text-[13px]" value={mode} onChange={(e) => setMode(e.target.value as Rule['mode'])}>
          {(Object.keys(MODE_PT) as Rule['mode'][]).map((m) => (
            <option key={m} value={m}>
              {MODE_PT[m]}
            </option>
          ))}
        </select>
        <Button secondary onClick={() => setOpen((v) => !v)}>
          {open ? 'Menos' : 'Voz e fontes'}
        </Button>
        <Button
          loading={busy}
          onClick={async () => {
            setBusy(true);
            try {
              await save({
                customerId,
                mode,
                voiceProfile: voice || undefined,
                knowledgeSummary: knowledge || undefined,
                knowledgeUrl: rule?.knowledgeUrl || undefined,
                autoLabels: rule?.autoLabels,
                ignoreLabels: rule?.ignoreLabels,
                notifyEmails: emails.split(',').map((s) => s.trim()).filter(Boolean),
              });
            } finally {
              setBusy(false);
            }
          }}
        >
          Salvar
        </Button>
      </div>
      {open && (
        <div className="flex flex-col gap-[8px] text-[13px]">
          <label className="opacity-70">Como esse perfil fala (primeira pessoa, o que nunca dizer, como fechar)</label>
          <textarea className="w-full min-h-[80px] rounded-[8px] p-[10px] bg-boxHover outline-none" value={voice} onChange={(e) => setVoice(e.target.value)} />
          <label className="opacity-70">O que é o perfil e onde estão as fontes (entra no prompt)</label>
          <textarea className="w-full min-h-[80px] rounded-[8px] p-[10px] bg-boxHover outline-none" value={knowledge} onChange={(e) => setKnowledge(e.target.value)} />
          <label className="opacity-70">E-mails de aviso quando entra item na fila (separados por vírgula)</label>
          <input className="w-full rounded-[8px] p-[10px] bg-boxHover outline-none" value={emails} onChange={(e) => setEmails(e.target.value)} />
        </div>
      )}
    </div>
  );
};
