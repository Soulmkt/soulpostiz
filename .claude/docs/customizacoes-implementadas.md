# Customizações implementadas no soulpostiz

Inventário do que já existe no fork além do upstream v2.23.0. Uma linha por
entrega, com a tag da imagem em que subiu e o card do SPTZ. Atualizar a cada
deploy.

| Data | Customização | Onde no código | Imagem | Card |
|---|---|---|---|---|
| 12/09/2026 | Fork criado, branch `soulmkt-main` congelada em v2.23.0, docs iniciais (`CLAUDE.md`, `PATCHES.md`, este arquivo) | raiz, `.claude/docs/` | (docs) | SPTZ-2 |
| 13/09/2026 | **Resposta automática na voz do canal (SPTZ-5)**: `SoulCommentsReplyService` (gera texto via Anthropic/OpenAI ou modelos prontos, publica em `/{comment}/replies`, registra motor, erro e tentativas; 3 falhas → fila), status `REPLY_READY`, `SOUL_REPLY_DRY_RUN` (ligado em produção até o app Meta ficar Live), API `/:id/reply` e `/:id/regenerate`. Provado em dry-run com os 3 seeds automáticos. **soul.5 (13/09):** regra do Gilmar aplicada: resposta nunca termina em pergunta, não presume o conteúdo do post (lê a legenda), e sem IA só elogio ganha modelo pronto (pergunta vai pra fila). | `libraries/nestjs-libraries/src/soul/comments/soul.comments.reply.service.ts` | `soulpostiz:v2.23.0-soul.5` | SPTZ-5 |
| 13/09/2026 | **Classificador e regras por Customer (SPTZ-4)**: `SoulCommentRule` (AUTO/REVIEW_ALL/OFF, autoLabels, ignoreLabels, voz, fontes, avisos), `SoulCommentsClassifierService` (8 rótulos, Anthropic/OpenAI por `ANTHROPIC_API_KEY`/`OPENAI_API_KEY`, heurística sem chave), status `AUTO_PENDING`, classificação na mesma volta do coletor, API `/soul/comments`. Provado com 8 comentários de teste (3 automático, 4 fila, 1 ignorado). | `libraries/nestjs-libraries/src/soul/comments/soul.comments.classifier.service.ts`, `apps/backend/src/soul/soul.comments.controller.ts`, `libraries/nestjs-libraries/src/dtos/soul/` | `soulpostiz:v2.23.0-soul.3` (commit 9eeae10) | SPTZ-4 |
| 12/09/2026 | **Coletor de comentários do Instagram (SPTZ-3)**: modelos `SoulMediaSync`/`SoulComment`, `SoulCommentsCollectorService`, activity + workflow infinito no Temporal (`soul-comments-collector-v1`), registro no start do backend. Ligado por `SOUL_COMMENTS_COLLECTOR=true`. Em produção lê mídias e contagens; a lista de comentários vem vazia enquanto o app Meta estiver em modo desenvolvimento (só usuários com papel no app aparecem). | `libraries/nestjs-libraries/src/soul/`, `apps/orchestrator/src/soul/`, `apps/orchestrator/src/workflows/soul.comments.workflow.ts` | `soulpostiz:v2.23.0-soul.2` (commit a90f98b) | SPTZ-3 |
| 12/09/2026 | **Primeiro deploy do fork em produção**, sem alteração de código: prova do pipeline build no VPS → dump → troca no compose → rollback documentado. Swap de 8 GB criado no VPS. | `.claude/skills/deploy.md`, `/root/soulpostiz-deploy.sh` no VPS | `soulpostiz:v2.23.0-soul.1` (commit 974415b) | SPTZ-1 |

Produção em 12/09/2026 22:20 UTC: `postiz.soulmkt.com.br` roda
`soulpostiz:v2.23.0-soul.1`. Imagem oficial anterior
(`ghcr.io/gitroomhq/postiz-app:v2.23.0`) continua no host pra rollback.

## Em desenvolvimento

- **Módulo Comentários, Fase 1 (Instagram)**: coletor, classificador com regras
  por Customer, resposta automática com exceções, tela, métrica, aviso.
  Cards SPTZ-3 a SPTZ-8. Desenho completo no soulconnect,
  `.claude/docs/soulpostiz-onboarding-dev.md` §2.
