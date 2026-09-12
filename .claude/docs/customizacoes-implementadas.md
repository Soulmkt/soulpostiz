# Customizações implementadas no soulpostiz

Inventário do que já existe no fork além do upstream v2.23.0. Uma linha por
entrega, com a tag da imagem em que subiu e o card do SPTZ. Atualizar a cada
deploy.

| Data | Customização | Onde no código | Imagem | Card |
|---|---|---|---|---|
| 12/09/2026 | Fork criado, branch `soulmkt-main` congelada em v2.23.0, docs iniciais (`CLAUDE.md`, `PATCHES.md`, este arquivo) | raiz, `.claude/docs/` | produção ainda na imagem oficial `ghcr.io/gitroomhq/postiz-app:v2.23.0` | SPTZ-1, SPTZ-2 |

## Em desenvolvimento

- **Módulo Comentários, Fase 1 (Instagram)**: coletor, classificador com regras
  por Customer, resposta automática com exceções, tela, métrica, aviso.
  Cards SPTZ-3 a SPTZ-8. Desenho completo no soulconnect,
  `.claude/docs/soulpostiz-onboarding-dev.md` §2.
