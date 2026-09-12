import { proxyActivities, sleep, continueAsNew } from '@temporalio/workflow';
import type { SoulCommentsActivity } from '@gitroom/orchestrator/soul/soul.comments.activity';

const { soulCollectComments } = proxyActivities<SoulCommentsActivity>({
  startToCloseTimeout: '9 minutes',
  retry: {
    maximumAttempts: 2,
    backoffCoefficient: 1,
    initialInterval: '1 minute',
  },
});

// Loop infinito: coleta, dorme, coleta. A cada 100 voltas recomeça com continueAsNew
// pra o histórico do Temporal não crescer sem limite.
export async function soulCommentsCollectorWorkflow(
  params: { intervalMinutes?: number; iteration?: number } = {}
) {
  const intervalMinutes = params.intervalMinutes ?? 10;
  let iteration = params.iteration ?? 0;

  while (true) {
    try {
      await soulCollectComments();
    } catch (err) {
      // a activity já tentou 2 vezes; a próxima volta tenta de novo
    }

    await sleep(`${intervalMinutes} minutes`);
    iteration++;

    if (iteration >= 100) {
      await continueAsNew<typeof soulCommentsCollectorWorkflow>({
        intervalMinutes,
        iteration: 0,
      });
    }
  }
}
