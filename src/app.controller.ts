import { Controller, Get, Res } from '@nestjs/common';
import type { Response } from 'express';
import { join } from 'path';

@Controller()
export class AppController {
  @Get()
  getTestClient(@Res() res: Response) {
    const filePath = join(process.cwd(), 'test_client.html');
    return res.sendFile(filePath);
  }
}