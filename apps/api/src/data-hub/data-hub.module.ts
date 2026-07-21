import { Module } from '@nestjs/common';
import { ManifestsController } from './manifests.controller';
import { ManifestsService } from './manifests.service';
import { ContainersController } from './containers.controller';
import { ContainersService } from './containers.service';

@Module({
  controllers: [ManifestsController, ContainersController],
  providers: [ManifestsService, ContainersService],
  exports: [ManifestsService, ContainersService],
})
export class DataHubModule {}
