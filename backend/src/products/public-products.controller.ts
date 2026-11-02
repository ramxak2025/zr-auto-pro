import { Controller, Get, Param, Res } from '@nestjs/common';
import { Response } from 'express';
import { ProductSharingService } from './product-sharing.service';

@Controller('public/products')
export class PublicProductsController {
  constructor(private readonly sharing: ProductSharingService) {}

  @Get(':token')
  async get(@Param('token') token: string, @Res() res: Response) {
    res.setHeader('Cache-Control', 'no-store');
    return res.json(await this.sharing.getPublic(token));
  }

  @Get(':token/images/:index')
  async image(@Param('token') token: string, @Param('index') index: string, @Res() res: Response) {
    const image = await this.sharing.image(token, index);
    res.setHeader('Content-Type', 'image/webp');
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    return res.send(image);
  }
}
