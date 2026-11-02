import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Delete,
  Header,
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
  AddManualInvoiceLineDto,
  ConfirmInvoiceDto,
  InvoiceLineReviewDto,
  InvoiceContextDto,
  InvoiceVersionDto,
  MapInvoiceLineDto,
  PrepareInvoiceDto,
} from './supplier-invoices.dto';

/** Bounded camera uploads; neither filename nor document text is logged. */
export async function invoiceUpload(req: Request): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const maximum = 10 * 1024 * 1024;
    let parser: ReturnType<typeof Busboy>;
    try {
      // Installed Busboy emits partsLimit when the allowed part count is
      // reached, so 1 would reject every valid one-file form. A second part is
      // still invalid through parts/files/fields events below.
      parser = Busboy({ headers: req.headers, limits: { fileSize: maximum + 1, files: 1, fields: 0, parts: 2 } });
    } catch {
      reject(new BadRequestException('Отправьте фотографию как multipart/form-data'));
      return;
    }
    const chunks: Buffer[] = [];
    let size = 0,
      files = 0,
      invalid = false,
      settled = false;
    const finish = (error?: Error, result?: Buffer) => {
      if (settled) return;
      settled = true;
      req.off('aborted', aborted);
      req.off('error', failed);
      if (error) {
        chunks.length = 0;
        req.once('error', () => undefined);
        req.unpipe(parser);
        if (!parser.destroyed) parser.destroy();
        req.resume();
        reject(error);
      } else resolve(result!);
    };
    const aborted = () => finish(new BadRequestException('Загрузка прервана'));
    const failed = () => finish(new BadRequestException('Не удалось прочитать фотографию'));
    parser.on('file', (_field, stream) => {
      files++;
      stream.on('data', (chunk: Buffer) => {
        size += chunk.length;
        if (size <= maximum) chunks.push(chunk);
        else invalid = true;
      });
      stream.on('limit', () => {
        invalid = true;
      });
      stream.on('error', failed);
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
    parser.on('error', failed);
    req.on('aborted', aborted);
    req.on('error', failed);
    parser.on('close', () => {
      if (settled) return;
      if (invalid || files !== 1 || !size) finish(new BadRequestException('Загрузите одну фотографию до 10 МБ'));
      else finish(undefined, Buffer.concat(chunks));
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
  @Header('Cache-Control', 'no-store')
  get(@Param('id', new ParseUUIDPipe()) id: string, @CurrentUser() actor: JwtPayload) {
    return this.invoices.get(id, actor);
  }
  @Post(':id/pages')
  async upload(@Param('id', new ParseUUIDPipe()) id: string, @Req() req: Request, @CurrentUser() actor: JwtPayload) {
    return this.invoices.addPage(id, await invoiceUpload(req), actor);
  }
  @Delete(':id/pages/:pageId')
  deletePage(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Param('pageId', new ParseUUIDPipe()) pageId: string,
    @Body() dto: InvoiceVersionDto,
    @CurrentUser() actor: JwtPayload,
  ) {
    return this.invoices.deletePage(id, pageId, dto.expectedVersion, actor);
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
  @Patch(':id/lines/:lineId/review')
  reviewLine(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Param('lineId', new ParseUUIDPipe()) lineId: string,
    @Body() dto: InvoiceLineReviewDto,
    @CurrentUser() actor: JwtPayload,
  ) {
    return this.invoices.reviewLine(id, lineId, dto, actor);
  }
  @Post(':id/manual-lines')
  manualLine(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: AddManualInvoiceLineDto,
    @CurrentUser() actor: JwtPayload,
  ) {
    return this.invoices.addManualLine(id, dto, actor);
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
