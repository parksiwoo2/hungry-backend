import {
  Body,
  Controller,
  DefaultValuePipe,
  Get,
  Param,
  ParseIntPipe,
  Post,
  Query,
} from '@nestjs/common';
import { PRECEDENT_QUERY_CATALOG } from './external/precedent-query.catalog';
import { PrecedentService } from './external/precedent.service';
import { PrecedentHybridSearchService } from './search/precedent-hybrid-search.service';
import { PrecedentMatchService } from './search/precedent-match.service';
import { PrecedentModelQueryService } from './storage/precedent-model-query.service';
import { PrecedentStoreService } from './storage/precedent-store.service';

@Controller('precedent')
export class PrecedentController {
  constructor(
    private readonly precedentService: PrecedentService,
    private readonly precedentStoreService: PrecedentStoreService,
    private readonly precedentMatchService: PrecedentMatchService,
    private readonly precedentHybridSearchService: PrecedentHybridSearchService,
    private readonly precedentModelQueryService: PrecedentModelQueryService,
  ) {}

  @Get()
  getPrecedents(
    @Query('query', new DefaultValuePipe('*')) query: string,
    @Query('search', new DefaultValuePipe(1), ParseIntPipe) search: number,
    @Query('display', new DefaultValuePipe(10), ParseIntPipe) display: number,
    @Query('page', new DefaultValuePipe(1), ParseIntPipe) page: number,
    @Query('sort', new DefaultValuePipe('ddes')) sort: string,
  ) {
    return this.precedentService.getPrecedents({
      query,
      search,
      display,
      page,
      sort,
    });
  }

  @Get('stored/categories')
  getStoredCategories() {
    const categories = new Map<string, string[]>();

    PRECEDENT_QUERY_CATALOG.forEach(({ category, query }) => {
      categories.set(category, [...(categories.get(category) ?? []), query]);
    });

    return [...categories.entries()].map(([category, queries]) => ({
      category,
      queries,
    }));
  }

  @Get('stored')
  getStoredPrecedents(
    @Query('page', new DefaultValuePipe(1), ParseIntPipe) page: number,
    @Query('limit', new DefaultValuePipe(20), ParseIntPipe) limit: number,
    @Query('category') category?: string,
    @Query('query') query?: string,
  ) {
    return this.precedentStoreService.findAll({
      page,
      limit,
      category,
      query,
    });
  }

  @Get('stored/:id')
  getStoredPrecedent(@Param('id') id: string) {
    return this.precedentStoreService.findOne(id);
  }

  @Post('match')
  findMatches(@Body() body: unknown) {
    return this.precedentMatchService.findMatches(body);
  }

  @Post('search')
  searchStoredPrecedents(@Body() body: unknown) {
    return this.precedentHybridSearchService.search(body);
  }

  @Get('models/:model')
  getModelData(
    @Param('model') model: string,
    @Query('page', new DefaultValuePipe(1), ParseIntPipe) page: number,
    @Query('limit', new DefaultValuePipe(10), ParseIntPipe) limit: number,
    @Query('precedentId') precedentId?: string,
    @Query('issueId') issueId?: string,
  ) {
    return this.precedentModelQueryService.findAll(model, {
      page,
      limit,
      precedentId,
      issueId,
    });
  }

  @Get(':id')
  getPrecedent(@Param('id', ParseIntPipe) id: number) {
    return this.precedentService.getPrecedent(id);
  }
}
