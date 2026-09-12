import { Global, Injectable, Logger, Module, OnModuleInit } from '@nestjs/common';
import { TemporalService } from 'nestjs-temporal-core';

// Sobe os workflows infinitos do soulpostiz no Temporal quando o backend inicia.
// Espelho do InfiniteWorkflowRegister do upstream, mas com flag própria
// (SOUL_COMMENTS_COLLECTOR=true), porque RUN_CRON não está ligado em produção.
// O workflowId leva a versão: ao mudar a lógica do workflow, sobe SOUL_COMMENTS_WORKFLOW_VERSION
// e encerra o antigo no Temporal (workflow em execução não troca de código sozinho).
@Injectable()
export class SoulWorkflowsRegister implements OnModuleInit {
  private readonly _logger = new Logger('SoulWorkflowsRegister');

  constructor(private _temporalService: TemporalService) {}

  async onModuleInit(): Promise<void> {
    if (process.env.SOUL_COMMENTS_COLLECTOR !== 'true') {
      return;
    }

    const version = process.env.SOUL_COMMENTS_WORKFLOW_VERSION || '1';
    const intervalMinutes = Number(process.env.SOUL_COMMENTS_INTERVAL_MINUTES || 10) || 10;

    try {
      await this._temporalService.client
        ?.getRawClient()
        ?.workflow?.start('soulCommentsCollectorWorkflow', {
          workflowId: `soul-comments-collector-v${version}`,
          taskQueue: 'main',
          args: [{ intervalMinutes, iteration: 0 }],
        });
      this._logger.log(`coletor de comentários iniciado (v${version}, a cada ${intervalMinutes} min)`);
    } catch (err: any) {
      // já em execução é o caso normal depois de um restart do backend
      this._logger.log(`coletor de comentários já em execução (v${version}): ${err?.message || err}`);
    }
  }
}

@Global()
@Module({
  imports: [],
  controllers: [],
  providers: [SoulWorkflowsRegister],
  get exports() {
    return this.providers;
  },
})
export class SoulWorkflowsRegisterModule {}
