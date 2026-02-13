import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Client } from './entities/client.entity';
import { CreateClientDto } from './dto/create-client.dto';
import { UpdateClientDto } from './dto/update-client.dto';

@Injectable()
export class ClientsService {
  constructor(
    @InjectRepository(Client)
    private readonly repo: Repository<Client>,
  ) {}

  async findAll(tenantId: string, query: { page?: number; limit?: number; search?: string }) {
    const page = query.page || 1;
    const limit = query.limit || 20;
    const skip = (page - 1) * limit;

    const qb = this.repo.createQueryBuilder('client');
    qb.leftJoinAndSelect('client.cars', 'car');

    qb.where('client.tenantId = :tenantId', { tenantId });

    if (query.search) {
      qb.andWhere(
        '(client.fullName ILIKE :search OR client.phone ILIKE :search OR car.plateNumber ILIKE :search OR car.makeModel ILIKE :search)',
        { search: `%${query.search}%` },
      );
    }

    qb.orderBy('client.createdAt', 'DESC');
    qb.skip(skip).take(limit);

    const [data, total] = await qb.getManyAndCount();

    return { data, total, page, limit };
  }

  async findById(tenantId: string, id: string): Promise<Client> {
    const client = await this.repo.findOne({
      where: { id, tenantId },
      relations: ['cars', 'checks'],
    });

    if (!client) {
      throw new NotFoundException(`Client with id ${id} not found`);
    }

    return client;
  }

  async findByPhone(tenantId: string, phone: string): Promise<Client | null> {
    return this.repo.findOne({ where: { phone, tenantId } });
  }

  async create(tenantId: string, dto: CreateClientDto): Promise<Client> {
    const client = this.repo.create({ ...dto, tenantId });
    return this.repo.save(client);
  }

  async update(tenantId: string, id: string, dto: UpdateClientDto): Promise<Client> {
    const client = await this.findById(tenantId, id);
    Object.assign(client, dto);
    return this.repo.save(client);
  }

  async remove(tenantId: string, id: string): Promise<void> {
    const client = await this.findById(tenantId, id);
    await this.repo.softRemove(client);
  }

  async getClientStats(tenantId: string, id: string) {
    const client = await this.findById(tenantId, id);

    const result = await this.repo
      .createQueryBuilder('client')
      .leftJoin('client.checks', 'check')
      .select('COALESCE(SUM(check.totalRevenue), 0)', 'totalPayments')
      .where('client.id = :id', { id })
      .andWhere('client.tenantId = :tenantId', { tenantId })
      .getRawOne();

    return {
      clientId: client.id,
      fullName: client.fullName,
      totalPayments: parseFloat(result.totalPayments) || 0,
    };
  }
}
