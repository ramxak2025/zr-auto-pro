// ═══════════════════════════════════════════════════════════════════════════════
//  Shared API Request/Response types
// ═══════════════════════════════════════════════════════════════════════════════

import type { User } from '../types';

export interface LoginRequest {
  phone: string;
  password: string;
}

export interface LoginResponse {
  token: string;
  user: User;
}

export interface RegisterRequest {
  phone: string;
  password: string;
  fullName: string;
  tenantName?: string;
}

export interface PaginationParams {
  page?: number;
  limit?: number;
  search?: string;
}

export interface ChecksParams extends PaginationParams {
  masterId?: string;
  clientId?: string;
  carId?: string;
  dateFrom?: string;
  dateTo?: string;
  retail?: string;
}

export interface DateRangeParams {
  dateFrom?: string;
  dateTo?: string;
}

export interface CashFlowParams extends DateRangeParams {
  masterId?: string;
}

export interface CreateUserRequest {
  phone: string;
  password: string;
  fullName: string;
  role: string;
  salaryPercent?: number;
  permissions?: Record<string, boolean>;
}

export interface UpdateUserRequest {
  phone?: string;
  password?: string;
  fullName?: string;
  role?: string;
  salaryPercent?: number;
  permissions?: Record<string, boolean>;
  daysOff?: number[];
  isActive?: boolean;
}

export interface CreateClientRequest {
  fullName: string;
  phone: string;
  comment?: string;
}

export interface UpdateClientRequest {
  fullName?: string;
  phone?: string;
  comment?: string;
}

export interface CreateCarRequest {
  plateNumber: string;
  makeModel: string;
  comment?: string;
  clientId: string;
}

export interface UpdateCarRequest {
  plateNumber?: string;
  makeModel?: string;
  comment?: string;
  clientId?: string;
}

export interface CreateProductRequest {
  name: string;
  category?: string;
  photo?: string;
  costPrice: number;
  sellPrice: number;
  stock: number;
  minStock: number;
  unit?: string;
  isBundle?: boolean;
  bundleItems?: Array<{ productId: string; name: string; quantity: number }>;
}

export interface UpdateProductRequest {
  name?: string;
  category?: string;
  photo?: string;
  costPrice?: number;
  sellPrice?: number;
  stock?: number;
  minStock?: number;
  unit?: string;
  isBundle?: boolean;
  bundleItems?: Array<{ productId: string; name: string; quantity: number }>;
}

export interface StockUpdateRequest {
  type: 'income' | 'expense' | 'writeoff' | 'inventory';
  quantity: number;
  reason?: string;
}

export interface CreateServiceRequest {
  name: string;
  category?: string;
  defaultPrice: number;
  masterPercent?: number | null;
}

export interface UpdateServiceRequest {
  name?: string;
  category?: string;
  defaultPrice?: number;
  masterPercent?: number | null;
}

export interface CreateCheckRequest {
  date?: string;
  masterId: string;
  clientId: string;
  carId: string;
  mileage?: number;
  comment?: string;
  discount?: number;
  isDeferred?: boolean;
  paymentMethod: string;
  cashAmount?: number;
  cardAmount?: number;
  services: Array<{
    serviceId?: string;
    masterId?: string;
    name: string;
    price: number;
    quantity: number;
  }>;
  products: Array<{
    productId?: string;
    name: string;
    sellPrice: number;
    costPrice: number;
    quantity: number;
  }>;
}

export interface UpdateCheckRequest {
  date?: string;
  paymentMethod?: string;
  isDeferred?: boolean;
  comment?: string;
  cashAmount?: number;
  cardAmount?: number;
  clientId?: string;
  carId?: string;
  masterId?: string;
  mileage?: number;
  discount?: number;
  services?: Array<{
    serviceId?: string;
    masterId?: string;
    name: string;
    price: number;
    quantity: number;
  }>;
  products?: Array<{
    productId?: string;
    name: string;
    sellPrice: number;
    costPrice: number;
    quantity: number;
  }>;
}

export interface CreateSupplierRequest {
  name: string;
  phone?: string;
  contactPerson?: string;
  comment?: string;
}

export interface UpdateSupplierRequest {
  name?: string;
  phone?: string;
  contactPerson?: string;
  comment?: string;
}

export interface CreateDeliveryRequest {
  supplierId: string;
  date?: string;
  comment?: string;
  items: Array<{
    productId: string;
    quantity: number;
    price: number;
  }>;
}

export interface CreatePaymentRequest {
  supplierId: string;
  amount: number;
  date?: string;
  comment?: string;
}

export interface CreateScheduleRequest {
  userId: string;
  date: string;
  shiftStart?: string;
  shiftEnd?: string;
  isDayOff?: boolean;
  note?: string;
}

export interface UpdateScheduleRequest {
  shiftStart?: string;
  shiftEnd?: string;
  isDayOff?: boolean;
  note?: string;
}

export interface CreateWorkModeRequest {
  name: string;
  type: 'rotating' | 'weekly';
  workDays: number;
  offDays: number;
  weekDays?: number[];
  shiftStart: string;
  shiftEnd: string;
}

export interface UpdateWorkModeRequest {
  name?: string;
  type?: string;
  shiftStart?: string;
  shiftEnd?: string;
}

export interface CreateTenantRequest {
  name: string;
  phone?: string;
  address?: string;
  email?: string;
  description?: string;
  maxUsers?: number;
  isActive?: boolean;
  planId?: string;
  monthlyPrice?: number;
  subscriptionEnd?: string;
  subscriptionNote?: string;
  directorName?: string;
  directorPhone?: string;
  directorPassword?: string;
}

export interface UpdateTenantRequest {
  name?: string;
  phone?: string;
  address?: string;
  email?: string;
  description?: string;
  isActive?: boolean;
  maxUsers?: number;
  planId?: string;
  monthlyPrice?: number;
  subscriptionEnd?: string;
  subscriptionNote?: string;
}

export interface CreatePlanRequest {
  name: string;
  monthlyPrice: number;
  description?: string;
  features?: string[];
  maxUsers?: number;
  sortOrder?: number;
}

export interface UpdatePlanRequest {
  name?: string;
  monthlyPrice?: number;
  description?: string;
  features?: string[];
  maxUsers?: number;
  isActive?: boolean;
  sortOrder?: number;
}
