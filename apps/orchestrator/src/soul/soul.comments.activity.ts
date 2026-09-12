import { Injectable } from '@nestjs/common';
import { Activity, ActivityMethod } from 'nestjs-temporal-core';
import { SoulCommentsCollectorService } from '@gitroom/nestjs-libraries/soul/comments/soul.comments.collector.service';

@Injectable()
@Activity()
export class SoulCommentsActivity {
  constructor(private _collector: SoulCommentsCollectorService) {}

  @ActivityMethod()
  async soulCollectComments() {
    return this._collector.collectAll();
  }
}
