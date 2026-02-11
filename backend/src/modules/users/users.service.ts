import {
  Injectable,
  NotFoundException,
  ConflictException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, ILike } from 'typeorm';
import * as bcrypt from 'bcrypt';
import {
  User,
  UserRole,
  UserPermissions,
  DEFAULT_PERMISSIONS,
} from './entities/user.entity';
import { CreateUserDto } from './dto/create-user.dto';
import { UpdateUserDto } from './dto/update-user.dto';

@Injectable()
export class UsersService {
  constructor(
    @InjectRepository(User)
    private readonly repo: Repository<User>,
  ) {}

  async findAll(query: {
    page?: number;
    limit?: number;
    search?: string;
    role?: UserRole;
  }): Promise<{ data: User[]; total: number; page: number; limit: number }> {
    const page = query.page || 1;
    const limit = query.limit || 20;
    const skip = (page - 1) * limit;

    const qb = this.repo.createQueryBuilder('user');

    if (query.search) {
      qb.andWhere(
        '(user.fullName ILIKE :search OR user.username ILIKE :search)',
        { search: `%${query.search}%` },
      );
    }

    if (query.role) {
      qb.andWhere('user.role = :role', { role: query.role });
    }

    qb.orderBy('user.createdAt', 'DESC');
    qb.skip(skip).take(limit);

    const [data, total] = await qb.getManyAndCount();

    return { data, total, page, limit };
  }

  async findById(id: string): Promise<User> {
    const user = await this.repo.findOne({
      where: { id },
      relations: ['checks'],
    });

    if (!user) {
      throw new NotFoundException(`User with ID "${id}" not found`);
    }

    return user;
  }

  async findByUsername(username: string): Promise<User | null> {
    return this.repo.findOne({ where: { username } });
  }

  async create(dto: CreateUserDto): Promise<User> {
    const existing = await this.repo.findOne({
      where: { username: dto.username },
    });

    if (existing) {
      throw new ConflictException(
        `User with username "${dto.username}" already exists`,
      );
    }

    const hashedPassword = await bcrypt.hash(dto.password, 10);

    const permissions = DEFAULT_PERMISSIONS[dto.role];

    const user = this.repo.create({
      ...dto,
      password: hashedPassword,
      permissions,
    });

    return this.repo.save(user);
  }

  async update(id: string, dto: UpdateUserDto): Promise<User> {
    const user = await this.findById(id);

    if (dto.username && dto.username !== user.username) {
      const existing = await this.repo.findOne({
        where: { username: dto.username },
      });

      if (existing) {
        throw new ConflictException(
          `User with username "${dto.username}" already exists`,
        );
      }
    }

    if (dto.password) {
      dto.password = await bcrypt.hash(dto.password, 10);
    }

    Object.assign(user, dto);

    return this.repo.save(user);
  }

  async updatePermissions(
    id: string,
    permissions: Partial<UserPermissions>,
  ): Promise<User> {
    const user = await this.findById(id);

    user.permissions = {
      ...user.permissions,
      ...permissions,
    };

    return this.repo.save(user);
  }

  async remove(id: string): Promise<void> {
    const user = await this.findById(id);
    await this.repo.softRemove(user);
  }

  async getMasters(): Promise<User[]> {
    return this.repo.find({
      where: {
        role: UserRole.MASTER,
        isActive: true,
      },
      order: { fullName: 'ASC' },
    });
  }
}
