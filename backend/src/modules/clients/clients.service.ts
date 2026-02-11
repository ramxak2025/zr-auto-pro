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

  async findAll(query: { page?: number; limit?: number; search?: string }) {
    const page = query.page || 1;
    const limit = query.limit || 20;
    const skip = (page - 1) * limit;

    const qb = this.repo.createQueryBuilder('client');

    if (query.search) {
      qb.where(
        'client.fullName ILIKE :search OR client.phone ILIKE :search',
        { search: `%${query.search}%` },
      );
    }

    qb.orderBy('client.createdAt', 'DESC');
    qb.skip(skip).take(limit);

    const [data, total] = await qb.getManyAndCount();

    return { data, total, page, limit };
  }

  async findById(id: string): Promise<Client> {
    const client = await this.repo.findOne({
      where: { id },
      relations: ['cars', 'checks'],
    });

    if (!client) {
      throw new NotFoundException(`Client with id ${id} not found`);
    }

    return client;
  }

  async findByPhone(phone: string): Promise<Client | null> {
    return this.repo.findOne({ where: { phone } });
  }

  async create(dto: CreateClientDto): Promise<Client> {
    const client = this.repo.create(dto);
    return this.repo.save(client);
  }

  async update(id: string, dto: UpdateClientDto): Promise<Client> {
    const client = await this.findById(id);
    Object.assign(client, dto);
    return this.repo.save(client);
  }

  async remove(id: string): Promise<void> {
    const client = await this.findById(id);
    await this.repo.softRemove(client);
  }

  async getClientStats(id: string) {
    const client = await this.findById(id);

    const result = await this.repo
      .createQueryBuilder('client')
      .leftJoin('client.checks', 'check')
      .select('COALESCE(SUM(check.totalRevenue), 0)', 'totalPayments')
      .where('client.id = :id', { id })
      .getRawOne();

    return {
      clientId: client.id,
      fullName: client.fullName,
      totalPayments: parseFloat(result.totalPayments) || 0,
    };
  }
}
