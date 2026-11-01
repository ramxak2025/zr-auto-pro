import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import { Request, Response } from 'express';
import * as Busboy from 'busboy';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { PermissionsGuard, RequirePermission } from '../common/guards/permissions.guard';
import { CurrentUser, JwtPayload } from '../common/decorators/current-user.decorator';
import { SupplierInvoicesService } from './supplier-invoices.service';
import {
  ConfirmInvoiceDto,
  InvoiceContextDto,
  InvoiceVersionDto,
  MapInvoiceLineDto,
  PrepareInvoiceDto,
} from './supplier-invoices.dto';

/** Bounded camera uploads; neither filename nor document text is logged. */
export async function invoiceUpload(req: Request): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    let parser: ReturnType<typeof Busboy>;
    try {
      parser = Busboy({ headers: req.headers, limits: { fileSize: 10 * 1024 * 1024, files: 1, fields: 0, parts: 1 } });
    } catch {
      reject(new BadRequestException('Отправьте фотографию как multipart/form-data'));
      return;
    }
    const chunks: Buffer[] = [];
    let size = 0,
      files = 0,
      invalid = false;
    parser.on('file', (_field, stream) => {
      files++;
      stream.on('data', (chunk: Buffer) => {
        size += chunk.length;
        if (size <= 10 * 1024 * 1024) chunks.push(chunk);
        else invalid = true;
      });
      stream.on('limit', () => {
        invalid = true;
      });
      stream.on('error', () => {
        invalid = true;
      });
    });
    parser.on('filesLimit', () => {
      invalid = true;
    });
    parser.on('fieldsLimit', () => {
      invalid = true;
    });
    parser.on('partsLimit', () => {
      invalid = true;
    });
    parser.on('error', () => reject(new BadRequestException('Не удалось прочитать фотографию')));
    req.on('aborted', () => reject(new BadRequestException('Загрузка прервана')));
    parser.on('close', () => {
      if (invalid || files !== 1 || !size) reject(new BadRequestException('Загрузите одну фотографию до 10 МБ'));
      else resolve(Buffer.concat(chunks));
    });
    req.pipe(parser);
  });
}

@UseGuards(JwtAuthGuard, RolesGuard, PermissionsGuard)
@RequirePermission('suppliers_manage')
@Controller('supplier-invoices')
export class SupplierInvoicesController {
  constructor(private readonly invoices: SupplierInvoicesService) {}
  @Post('prepare')
  prepare(@Body() dto: PrepareInvoiceDto, @CurrentUser() actor: JwtPayload) {
    return this.invoices.prepare(dto.supplierId, actor, dto.orderId);
  }
  @Get(':id')
  get(@Param('id', new ParseUUIDPipe()) id: string, @CurrentUser() actor: JwtPayload) {
    return this.invoices.get(id, actor);
  }
  @Post(':id/pages')
  async upload(@Param('id', new ParseUUIDPipe()) id: string, @Req() req: Request, @CurrentUser() actor: JwtPayload) {
    return this.invoices.addPage(id, await invoiceUpload(req), actor);
  }
  @Get(':id/pages/:pageId')
  async page(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Param('pageId', new ParseUUIDPipe()) pageId: string,
    @CurrentUser() actor: JwtPayload,
    @Res() res: Response,
  ) {
    const image = await this.invoices.page(id, pageId, actor);
    res.setHeader('Content-Type', 'image/jpeg');
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.send(image);
  }
  @Post(':id/extract')
  extract(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: InvoiceVersionDto,
    @CurrentUser() actor: JwtPayload,
  ) {
    return this.invoices.extract(id, dto.expectedVersion, actor);
  }
  @Patch(':id/context')
  context(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: InvoiceContextDto,
    @CurrentUser() actor: JwtPayload,
  ) {
    return this.invoices.setOrder(id, dto.expectedVersion, dto.orderId ?? null, actor);
  }
  @Patch(':id/lines/:lineId')
  map(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Param('lineId', new ParseUUIDPipe()) lineId: string,
    @Body() dto: MapInvoiceLineDto,
    @CurrentUser() actor: JwtPayload,
  ) {
    return this.invoices.mapLine(id, lineId, dto, actor);
  }
  @Post(':id/confirm')
  confirm(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: ConfirmInvoiceDto,
    @CurrentUser() actor: JwtPayload,
  ) {
    return this.invoices.confirm(id, dto, actor);
  }
}
