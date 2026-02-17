import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, ILike } from 'typeorm';
import { Client } from './client.entity';

@Injectable()
export class ClientsService {
  constructor(
    @InjectRepository(Client)
    private readonly clientsRepo: Repository<Client>,
  ) {}

  async findAll(
    tenantId: string,
    search?: string,
    page = 1,
    limit = 50,
  ): Promise<{ data: Client[]; total: number; page: number; limit: number }> {
    const where: any[] = [];

    if (search) {
      where.push(
        { tenantId, fullName: ILike(`%${search}%`) },
        { tenantId, phone: ILike(`%${search}%`) },
      );
    } else {
      where.push({ tenantId });
    }

    const [data, total] = await this.clientsRepo.findAndCount({
      where,
      relations: ['cars'],
      order: { createdAt: 'DESC' },
      skip: (page - 1) * limit,
      take: limit,
    });

    return { data, total, page, limit };
  }

  async findById(id: string): Promise<Client> {
    const client = await this.clientsRepo.findOne({
      where: { id },
      relations: ['cars', 'cars.client'],
    });
    if (!client) {
      throw new NotFoundException(`Client with id "${id}" not found`);
    }
    return client;
  }

  async create(dto: Partial<Client>): Promise<Client> {
    const client = this.clientsRepo.create(dto);
    return this.clientsRepo.save(client);
  }

  async update(id: string, dto: Partial<Client>): Promise<Client> {
    const client = await this.findById(id);
    Object.assign(client, dto);
    return this.clientsRepo.save(client);
  }

  async remove(id: string): Promise<void> {
    const result = await this.clientsRepo.delete(id);
    if (result.affected === 0) {
      throw new NotFoundException(`Client with id "${id}" not found`);
    }
  }
}
