import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Car } from './car.entity';

@Injectable()
export class CarsService {
  constructor(
    @InjectRepository(Car)
    private readonly carsRepo: Repository<Car>,
  ) {}

  async findAll(tenantId: string, clientId?: string): Promise<Car[]> {
    const where: any = { tenantId };
    if (clientId) {
      where.clientId = clientId;
    }

    return this.carsRepo.find({
      where,
      relations: ['client'],
      order: { createdAt: 'DESC' },
    });
  }

  async findById(id: string): Promise<Car> {
    const car = await this.carsRepo.findOne({
      where: { id },
      relations: ['client'],
    });
    if (!car) {
      throw new NotFoundException(`Car with id "${id}" not found`);
    }
    return car;
  }

  async create(dto: Partial<Car>): Promise<Car> {
    const car = this.carsRepo.create(dto);
    return this.carsRepo.save(car);
  }

  async update(id: string, dto: Partial<Car>): Promise<Car> {
    const car = await this.findById(id);
    Object.assign(car, dto);
    return this.carsRepo.save(car);
  }

  async remove(id: string): Promise<void> {
    const result = await this.carsRepo.delete(id);
    if (result.affected === 0) {
      throw new NotFoundException(`Car with id "${id}" not found`);
    }
  }
}
