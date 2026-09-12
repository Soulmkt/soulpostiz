# Customizações implementadas no soulpostiz

Inventário do que já existe no fork além do upstream v2.23.0. Uma linha por
entrega, com a tag da imagem em que subiu e o card do SPTZ. Atualizar a cada
deploy.

| Data | Customização | Onde no código | Imagem | Card |
|---|---|---|---|---|
| 12/09/2026 | Fork criado, branch `soulmkt-main` congelada em v2.23.0, docs iniciais (`CLAUDE.md`, `PATCHES.md`, este arquivo) | raiz, `.claude/docs/` | (docs) | SPTZ-2 |
| 12/09/2026 | **Primeiro deploy do fork em produção**, sem alteração de código: prova do pipeline build no VPS → dump → troca no compose → rollback documentado. Swap de 8 GB criado no VPS. | `.claude/skills/deploy.md`, `/root/soulpostiz-deploy.sh` no VPS | `soulpostiz:v2.23.0-soul.1` (commit 974415b) | SPTZ-1 |

Produção em 12/09/2026 22:20 UTC: `postiz.soulmkt.com.br` roda
`soulpostiz:v2.23.0-soul.1`. Imagem oficial anterior
(`ghcr.io/gitroomhq/postiz-app:v2.23.0`) continua no host pra rollback.

## Em desenvolvimento

- **Módulo Comentários, Fase 1 (Instagram)**: coletor, classificador com regras
  por Customer, resposta automática com exceções, tela, métrica, aviso.
  Cards SPTZ-3 a SPTZ-8. Desenho completo no soulconnect,
  `.claude/docs/soulpostiz-onboarding-dev.md` §2.
