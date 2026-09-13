# soulpostiz: guia para o Claude e para quem desenvolve

Fork do [Postiz](https://github.com/gitroomhq/postiz-app) mantido pela
SoulMkt. Roda em `postiz.soulmkt.com.br`. Versão base **congelada na
v2.23.0** (tag do upstream, commit `1e4c8dd`), branch de trabalho
**`soulmkt-main`**. `main` só espelha o upstream para comparação.

Documentação de entrada, decisões e contexto: repo `soulconnect`,
`.claude/docs/soulpostiz-onboarding-dev.md`. Registro de cada trabalho: projeto
**SPTZ** no Plane (`plane.soulmkt.com.br`, workspace desenvolvimento).

## Regras absolutas

1. **Nunca atualizar o upstream por impulso.** Release nova é candidata a merge,
   decidida pelo Gilmar e registrada no SPTZ-10. Merge sempre em branch, com
   testes e dump do banco antes de subir.
2. **Código novo em pastas `soul/`**: `apps/backend/src/soul/`,
   `apps/frontend/src/components/soul/`, `apps/orchestrator/src/soul/`,
   `libraries/nestjs-libraries/src/soul/`. Modelos Prisma com prefixo `Soul`.
3. **Todo toque em arquivo do core vai pro `PATCHES.md`** (arquivo, motivo,
   como reaplicar). Toque mínimo: import, item de menu, rota registrada.
4. **Migração Prisma nomeada** (`soul_<assunto>`). Nunca `db push` em produção.
5. **Segredo nenhum no repo.** `.env` real só no VPS (`/opt/postiz/.env`) e no
   souldesk (acesso `postiz`).
6. **Texto de interface em pt-BR**, sem travessão.
7. **Imagem própria** `soulpostiz:v2.23.0-soul.N`; o compose de produção nunca
   aponta pra `latest`.
8. **Inventário atualizado**: toda customização entregue entra em
   `.claude/docs/customizacoes-implementadas.md` e no card do SPTZ, com a tag
   da imagem em que subiu.

## Mapa do repo (o que importa pra nós)

| Onde | O que |
|---|---|
| `apps/backend` | API NestJS (rotas em `src/api/routes/`) |
| `apps/frontend` | Next.js (menu, telas) |
| `apps/orchestrator` | workflows/activities do Temporal; providers publicam daqui; o coletor de comentários roda aqui |
| `apps/workers`, `apps/cron` | filas e tarefas agendadas |
| `libraries/nestjs-libraries/src/database/prisma/schema.prisma` | banco |
| `libraries/nestjs-libraries/src/integrations/social/` | providers (instagram, instagram.standalone, tiktok...) |

## Customizações

Ver `.claude/docs/customizacoes-implementadas.md`. A primeira é o **módulo
Comentários** (Fase 1: Instagram; Fase 2: TikTok), desenho na doc de entrada
do soulconnect §2 e nos cards SPTZ-3 a SPTZ-8.

## Variáveis de ambiente do fork (no `.env` do VPS)

| Variável | Default | Efeito |
|---|---|---|
| `SOUL_COMMENTS_COLLECTOR` | (desligado) | `true` sobe o workflow `soul-comments-collector-v<versão>` no Temporal quando o backend inicia |
| `SOUL_COMMENTS_INTERVAL_MINUTES` | `10` | intervalo entre rodadas do coletor |
| `SOUL_COMMENTS_LOOKBACK_DAYS` | `30` | mídias mais antigas que isso não são lidas |
| `ANTHROPIC_API_KEY` ou `OPENAI_API_KEY` | (vazio) | classificador usa Anthropic (preferido) ou OpenAI; sem chave cai na heurística conservadora |
| `SOUL_CLASSIFIER_MODEL` | `claude-haiku-4-5-20251001` / `gpt-4.1-mini` | modelo do classificador |
| `SOUL_REPLY_DRY_RUN` | (desligado) | `true` gera o texto da resposta e para em REPLY_READY, sem publicar. Manter ligado até o app Meta estar Live |
| `SOUL_REPLY_MODEL` | igual ao classificador | modelo do gerador de resposta |
| `SOUL_COMMENTS_WORKFLOW_VERSION` | `1` | entra no workflowId; subir ao mudar a lógica do workflow e encerrar o antigo no Temporal |

## Regras de voz das respostas (Gilmar, 13/09/2026)

- A resposta **nunca termina em pergunta**.
- **Ler a legenda antes**: o post pode ser apresentação do acervo, calendário, ecossistema, espécie
  ou história; nunca presumir "essa eu fotografei".
- Elogio: agradecer o que a pessoa disse em 1 frase, no máximo 2. Primeira pessoa, sem nome, sem travessão.
- Sem chave de IA, só elogio recebe modelo pronto; pergunta vai pra revisão humana.

## Gotchas

- **App Meta em modo desenvolvimento filtra dados de terceiros.** `GET /{media}/comments` devolve
  `data: []` com cursores mesmo com `comments_count > 0`. Não é bug do coletor, e **conta testadora
  também é filtrada** (medido 12/09/2026 com palhassoulmkt): o conteúdo dos comentários só
  aparece com o app Live após App Review (SPTZ-11). O campo aninhado `comments{...}` é
  omitido em silêncio, `comments_count` vem normal.
- O compose de produção declara cada variável em `environment:`; variável nova no `.env` **não
  chega ao container** sem a linha correspondente no `docker-compose.yml`.
- Workflow em execução no Temporal não troca de código: ao mudar a lógica do workflow, subir
  `SOUL_COMMENTS_WORKFLOW_VERSION` (novo workflowId) e encerrar o antigo.

## Ambiente local

Guia oficial: `https://docs.postiz.app/installation/development`. WSL, Node 20+,
pnpm, `docker-compose.dev.yaml` (Postgres, Redis, Temporal), `pnpm run
prisma-db-push`, `pnpm run dev`.

## Deploy

Sem CI e sem staging. Dump → build no VPS → troca da tag no compose → `up -d`
→ conferir → registrar. Passo a passo na doc de entrada §7 (validar no
primeiro deploy, card SPTZ-1). Evitar 12h e 18h BRT (posts do acervo).
