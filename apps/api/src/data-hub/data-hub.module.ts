import { Module } from '@nestjs/common';
import { ManifestsController } from './manifests.controller';
import { ManifestsService } from './manifests.service';
import { ContainersController } from './containers.controller';
import { ContainersService } from './containers.service';
import { DeadlinesModule } from '../deadlines/deadlines.module';

@Module({
  imports: [DeadlinesModule],
  controllers: [ManifestsController, ContainersController],
  providers: [ManifestsService, ContainersService],
  exports: [ManifestsService, ContainersService],
})
export class DataHubModule {}
