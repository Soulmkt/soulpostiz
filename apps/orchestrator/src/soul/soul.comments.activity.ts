import { Injectable } from '@nestjs/common';
import { Activity, ActivityMethod } from 'nestjs-temporal-core';
import { SoulCommentsCollectorService } from '@gitroom/nestjs-libraries/soul/comments/soul.comments.collector.service';
import { SoulCommentsClassifierService } from '@gitroom/nestjs-libraries/soul/comments/soul.comments.classifier.service';

@Injectable()
@Activity()
export class SoulCommentsActivity {
  constructor(
    private _collector: SoulCommentsCollectorService,
    private _classifier: SoulCommentsClassifierService
  ) {}

  // Coleta e, na mesma volta, classifica o que entrou como NEW (o workflow não muda)
  @ActivityMethod()
  async soulCollectComments() {
    const collect = await this._collector.collectAll();
    const classify = await this._classifier.classifyNew(100);
    return { collect, classify };
  }
}
