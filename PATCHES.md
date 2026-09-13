# PATCHES.md: arquivos do core tocados pelo fork

Regra: código novo vive em pastas `soul/`. Este arquivo lista **só** o que foi
alterado em arquivo que já existia no upstream, com motivo e como reaplicar
depois de um merge. Sem entrada aqui = nenhum arquivo do core foi tocado.

Base: upstream `gitroomhq/postiz-app` tag `v2.23.0` (commit `1e4c8dd`).

| Arquivo | Motivo | Como reaplicar | Card |
|---|---|---|---|
| `libraries/nestjs-libraries/src/database/prisma/schema.prisma` | enums `SoulCommentStatus`, `SoulCommentMode` e modelos `SoulMediaSync`, `SoulComment`, `SoulCommentRule` (bloco no fim do arquivo, sem relação com modelos do upstream) | recolar o bloco `// soulpostiz (SoulMkt): módulo Comentários` no fim do schema | SPTZ-3, SPTZ-4 |
| `libraries/nestjs-libraries/src/database/prisma/database.module.ts` | registrar `SoulCommentsRepository`, `SoulCommentsCollectorService`, `SoulCommentsClassifierService` e `SoulCommentsReplyService` (4 imports + 4 providers, marcados `// soulpostiz`) | reinserir os imports e as duas linhas em `providers` (o `exports` devolve `providers`) | SPTZ-3 |
| `apps/orchestrator/src/app.module.ts` | registrar `SoulCommentsActivity` como activity do Temporal (1 import + 1 item no array `activities`) | reinserir import e item marcados `// soulpostiz` | SPTZ-3 |
| `apps/orchestrator/src/workflows/index.ts` | exportar `soul.comments.workflow` pro bundle de workflows | reinserir a linha `export * from './soul.comments.workflow'` | SPTZ-3 |
| `apps/frontend/src/components/layout/top.menu.tsx` | item "Comentários" no menu principal, depois de Plugs (bloco marcado `// soulpostiz`) | reinserir o objeto do item em `firstMenu` | SPTZ-6 |
| `apps/backend/src/api/api.module.ts` | registrar `SoulCommentsController` (1 import + 1 item em `authenticatedController`) | reinserir import e item marcados `// soulpostiz` | SPTZ-4 |
| `apps/backend/src/app.module.ts` | importar `SoulWorkflowsRegisterModule` (sobe o workflow do coletor no start do backend) | reinserir import e item em `imports` logo após `InfiniteWorkflowRegisterModule` | SPTZ-3 |

Nenhuma linha existente do upstream foi alterada; só inserções marcadas com o
comentário `// soulpostiz`, o que deixa o `git merge` do upstream sem conflito
na maioria dos casos.
