import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Car } from './entities/car.entity';
import { CreateCarDto } from './dto/create-car.dto';
import { UpdateCarDto } from './dto/update-car.dto';

@Injectable()
export class CarsService {
  constructor(
    @InjectRepository(Car)
    private readonly repo: Repository<Car>,
  ) {}

  async findAll(tenantId: string, query: {
    page?: number;
    limit?: number;
    search?: string;
    clientId?: string;
  }): Promise<{ data: Car[]; total: number; page: number; limit: number }> {
    const page = query.page || 1;
    const limit = query.limit || 20;
    const skip = (page - 1) * limit;

    const qb = this.repo.createQueryBuilder('car');

    qb.where('car.tenantId = :tenantId', { tenantId });

    if (query.search) {
      qb.andWhere(
        '(car.plateNumber ILIKE :search OR car.makeModel ILIKE :search)',
        { search: `%${query.search}%` },
      );
    }

    if (query.clientId) {
      qb.andWhere('car.clientId = :clientId', { clientId: query.clientId });
    }

    qb.orderBy('car.createdAt', 'DESC');
    qb.skip(skip).take(limit);

    const [data, total] = await qb.getManyAndCount();

    return { data, total, page, limit };
  }

  async findById(tenantId: string, id: string): Promise<Car> {
    const car = await this.repo.findOne({
      where: { id, tenantId },
      relations: ['client', 'checks'],
    });

    if (!car) {
      throw new NotFoundException(`Car with id "${id}" not found`);
    }

    return car;
  }

  async findByPlateNumber(tenantId: string, plateNumber: string): Promise<Car | null> {
    return this.repo.findOne({ where: { plateNumber, tenantId } });
  }

  async create(tenantId: string, dto: CreateCarDto): Promise<Car> {
    const car = this.repo.create({ ...dto, tenantId });
    return this.repo.save(car);
  }

  async update(tenantId: string, id: string, dto: UpdateCarDto): Promise<Car> {
    const car = await this.findById(tenantId, id);
    Object.assign(car, dto);
    return this.repo.save(car);
  }

  async remove(tenantId: string, id: string): Promise<void> {
    const car = await this.findById(tenantId, id);
    await this.repo.softRemove(car);
  }

  async findByClientId(tenantId: string, clientId: string): Promise<Car[]> {
    return this.repo.find({
      where: { clientId, tenantId },
      order: { createdAt: 'DESC' },
    });
  }
}
