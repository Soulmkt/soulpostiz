import { Injectable } from '@nestjs/common';
import { Activity, ActivityMethod } from 'nestjs-temporal-core';
import { SoulCommentsCollectorService } from '@gitroom/nestjs-libraries/soul/comments/soul.comments.collector.service';
import { SoulCommentsClassifierService } from '@gitroom/nestjs-libraries/soul/comments/soul.comments.classifier.service';
import { SoulCommentsReplyService } from '@gitroom/nestjs-libraries/soul/comments/soul.comments.reply.service';

@Injectable()
@Activity()
export class SoulCommentsActivity {
  constructor(
    private _collector: SoulCommentsCollectorService,
    private _classifier: SoulCommentsClassifierService,
    private _reply: SoulCommentsReplyService
  ) {}

  // Coleta, classifica o que entrou como NEW e responde o que ficou AUTO_PENDING, na mesma volta
  // (o workflow v1 não muda)
  @ActivityMethod()
  async soulCollectComments() {
    const collect = await this._collector.collectAll();
    const classify = await this._classifier.classifyNew(100);
    const reply = await this._reply.processAutoPending(50);
    return { collect, classify, reply };
  }
}
