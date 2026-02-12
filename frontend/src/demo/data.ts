import type {
  User,
  Client,
  Car,
  Product,
  Service,
  Check,
  Supplier,
  DashboardStats,
  SalarySummary,
  FinancialReport,
  MasterSalary,
} from '../types';
import { UserRole, PaymentMethod } from '../types';

// ---- Tenant ----
const tenant = {
  id: 'demo-tenant-1',
  name: 'АвтоМастер Про',
  slug: 'avtomaster-pro',
  phone: '+7 (999) 123-45-67',
  address: 'г. Москва, ул. Автосервисная, д. 12',
  isActive: true,
  maxUsers: 10,
  createdAt: '2024-01-15T10:00:00Z',
  updatedAt: '2024-01-15T10:00:00Z',
};

// ---- Users ----
const allPermissions = {
  checks_view: true,
  checks_create: true,
  checks_edit: true,
  checks_delete: true,
  profit_view: true,
  clients_view: true,
  clients_edit: true,
  warehouse_access: true,
  suppliers_access: true,
  financial_reports: true,
  export_data: true,
  user_management: true,
};

export const demoUser: User = {
  id: 'user-owner-1',
  username: 'demo',
  fullName: 'Алексей Иванов',
  role: UserRole.OWNER,
  salaryPercent: 0,
  permissions: allPermissions,
  isActive: true,
  tenantId: tenant.id,
  tenant,
  createdAt: '2024-01-15T10:00:00Z',
};

export const demoMasterUser: User = {
  id: 'user-master-1',
  username: 'sergey',
  fullName: 'Сергей Козлов',
  role: UserRole.MASTER,
  salaryPercent: 35,
  permissions: {
    checks_view: true,
    checks_create: true,
    checks_edit: false,
    checks_delete: false,
    profit_view: false,
    clients_view: true,
    clients_edit: false,
    warehouse_access: true,
    suppliers_access: false,
    financial_reports: false,
    export_data: false,
    user_management: false,
  },
  isActive: true,
  tenantId: tenant.id,
  tenant,
  createdAt: '2024-02-10T10:00:00Z',
};

export const demoUsers: User[] = [
  demoUser,
  {
    id: 'user-admin-1',
    username: 'admin',
    fullName: 'Мария Петрова',
    role: UserRole.ADMIN,
    salaryPercent: 0,
    permissions: allPermissions,
    isActive: true,
    tenantId: tenant.id,
    createdAt: '2024-02-01T10:00:00Z',
  },
  {
    id: 'user-master-1',
    username: 'sergey',
    fullName: 'Сергей Козлов',
    role: UserRole.MASTER,
    salaryPercent: 35,
    permissions: {
      checks_view: true,
      checks_create: true,
      checks_edit: false,
      checks_delete: false,
      profit_view: false,
      clients_view: true,
      clients_edit: false,
      warehouse_access: true,
      suppliers_access: false,
      financial_reports: false,
      export_data: false,
      user_management: false,
    },
    isActive: true,
    tenantId: tenant.id,
    createdAt: '2024-02-10T10:00:00Z',
  },
  {
    id: 'user-master-2',
    username: 'dmitry',
    fullName: 'Дмитрий Смирнов',
    role: UserRole.MASTER,
    salaryPercent: 30,
    permissions: {
      checks_view: true,
      checks_create: true,
      checks_edit: false,
      checks_delete: false,
      profit_view: false,
      clients_view: true,
      clients_edit: false,
      warehouse_access: true,
      suppliers_access: false,
      financial_reports: false,
      export_data: false,
      user_management: false,
    },
    isActive: true,
    tenantId: tenant.id,
    createdAt: '2024-03-05T10:00:00Z',
  },
  {
    id: 'user-store-1',
    username: 'store',
    fullName: 'Елена Волкова',
    role: UserRole.STOREKEEPER,
    salaryPercent: 0,
    permissions: {
      checks_view: true,
      checks_create: false,
      checks_edit: false,
      checks_delete: false,
      profit_view: false,
      clients_view: true,
      clients_edit: false,
      warehouse_access: true,
      suppliers_access: true,
      financial_reports: false,
      export_data: false,
      user_management: false,
    },
    isActive: true,
    tenantId: tenant.id,
    createdAt: '2024-03-20T10:00:00Z',
  },
];

// ---- Clients ----
export const demoClients: Client[] = [
  {
    id: 'client-1',
    fullName: 'Андрей Николаев',
    phone: '+7 (903) 555-12-34',
    comment: 'Постоянный клиент',
    createdAt: '2024-02-20T10:00:00Z',
  },
  {
    id: 'client-2',
    fullName: 'Ольга Федорова',
    phone: '+7 (916) 777-88-99',
    createdAt: '2024-03-10T10:00:00Z',
  },
  {
    id: 'client-3',
    fullName: 'Игорь Белов',
    phone: '+7 (925) 111-22-33',
    comment: 'VIP клиент, скидка 10%',
    createdAt: '2024-03-15T10:00:00Z',
  },
  {
    id: 'client-4',
    fullName: 'Екатерина Морозова',
    phone: '+7 (905) 444-55-66',
    createdAt: '2024-04-01T10:00:00Z',
  },
  {
    id: 'client-5',
    fullName: 'Виктор Кузнецов',
    phone: '+7 (910) 222-33-44',
    createdAt: '2024-04-12T10:00:00Z',
  },
  {
    id: 'client-6',
    fullName: 'Наталья Соколова',
    phone: '+7 (977) 666-77-88',
    createdAt: '2024-05-01T10:00:00Z',
  },
];

// ---- Cars ----
export const demoCars: Car[] = [
  {
    id: 'car-1',
    plateNumber: 'А123ВС77',
    makeModel: 'Toyota Camry 2019',
    clientId: 'client-1',
    client: demoClients[0],
    createdAt: '2024-02-20T10:00:00Z',
  },
  {
    id: 'car-2',
    plateNumber: 'К456МН50',
    makeModel: 'BMW X5 2021',
    clientId: 'client-2',
    client: demoClients[1],
    createdAt: '2024-03-10T10:00:00Z',
  },
  {
    id: 'car-3',
    plateNumber: 'Е789ОР197',
    makeModel: 'Kia Sportage 2022',
    clientId: 'client-3',
    client: demoClients[2],
    createdAt: '2024-03-15T10:00:00Z',
  },
  {
    id: 'car-4',
    plateNumber: 'Р012СТ99',
    makeModel: 'Hyundai Tucson 2020',
    clientId: 'client-4',
    client: demoClients[3],
    createdAt: '2024-04-01T10:00:00Z',
  },
  {
    id: 'car-5',
    plateNumber: 'У345ФХ77',
    makeModel: 'Mercedes-Benz C200 2023',
    clientId: 'client-5',
    client: demoClients[4],
    createdAt: '2024-04-12T10:00:00Z',
  },
  {
    id: 'car-6',
    plateNumber: 'Х678ЦЧ150',
    makeModel: 'Volkswagen Tiguan 2021',
    clientId: 'client-1',
    client: demoClients[0],
    createdAt: '2024-05-01T10:00:00Z',
  },
];

// ---- Products ----
const img = (text: string, bg = 'e2e8f0', fg = '475569') =>
  `https://placehold.co/200x200/${bg}/${fg}?text=${encodeURIComponent(text)}`;

export const demoProducts: Product[] = [
  { id: 'prod-1', name: 'Масло моторное Castrol 5W-30 4L', category: 'Масла', costPrice: 2100, sellPrice: 3200, stock: 15, minStock: 5, photo: img('Castrol\n5W-30', 'fef3c7', '92400e'), createdAt: '2024-01-20T10:00:00Z' },
  { id: 'prod-2', name: 'Фильтр масляный Toyota', category: 'Фильтры', costPrice: 350, sellPrice: 650, stock: 20, minStock: 5, photo: img('Фильтр\nмасл.', 'dbeafe', '5b21b6'), createdAt: '2024-01-20T10:00:00Z' },
  { id: 'prod-3', name: 'Фильтр воздушный универсальный', category: 'Фильтры', costPrice: 280, sellPrice: 550, stock: 12, minStock: 5, photo: img('Фильтр\nвозд.', 'dbeafe', '5b21b6'), createdAt: '2024-01-20T10:00:00Z' },
  { id: 'prod-4', name: 'Колодки тормозные передние ATE', category: 'Тормозная система', costPrice: 1800, sellPrice: 3100, stock: 8, minStock: 3, photo: img('Колодки\nATE', 'fecaca', '991b1b'), createdAt: '2024-02-10T10:00:00Z' },
  { id: 'prod-5', name: 'Диски тормозные передние Brembo', category: 'Тормозная система', costPrice: 4200, sellPrice: 6800, stock: 4, minStock: 2, photo: img('Диски\nBrembo', 'fecaca', '991b1b'), createdAt: '2024-02-10T10:00:00Z' },
  { id: 'prod-6', name: 'Антифриз G12+ 5L', category: 'Жидкости', costPrice: 450, sellPrice: 850, stock: 10, minStock: 3, photo: img('Антифриз\nG12+', 'bfdbfe', '1e40af'), createdAt: '2024-02-15T10:00:00Z' },
  { id: 'prod-7', name: 'Свеча зажигания NGK', category: 'Электрика', costPrice: 180, sellPrice: 380, stock: 30, minStock: 10, photo: img('Свеча\nNGK', 'fef9c3', '854d0e'), createdAt: '2024-02-20T10:00:00Z' },
  { id: 'prod-8', name: 'Ремень ГРМ Continental', category: 'ГРМ', costPrice: 1500, sellPrice: 2800, stock: 3, minStock: 2, photo: img('Ремень\nГРМ', 'e2e8f0', '334155'), createdAt: '2024-03-01T10:00:00Z' },
  { id: 'prod-9', name: 'Амортизатор задний KYB', category: 'Подвеска', costPrice: 3500, sellPrice: 5500, stock: 2, minStock: 2, photo: img('Аморт.\nKYB', 'd1fae5', '166534'), createdAt: '2024-03-10T10:00:00Z' },
  { id: 'prod-10', name: 'Жидкость тормозная DOT-4 1L', category: 'Жидкости', costPrice: 220, sellPrice: 450, stock: 8, minStock: 3, photo: img('DOT-4', 'bfdbfe', '1e40af'), createdAt: '2024-03-15T10:00:00Z' },
];

// ---- Services ----
export const demoServices: Service[] = [
  { id: 'svc-1', name: 'Замена масла', category: 'ТО', defaultPrice: 1500, createdAt: '2024-01-15T10:00:00Z' },
  { id: 'svc-2', name: 'Замена масляного фильтра', category: 'ТО', defaultPrice: 500, createdAt: '2024-01-15T10:00:00Z' },
  { id: 'svc-3', name: 'Замена воздушного фильтра', category: 'ТО', defaultPrice: 400, createdAt: '2024-01-15T10:00:00Z' },
  { id: 'svc-4', name: 'Замена тормозных колодок (ось)', category: 'Тормоза', defaultPrice: 2500, createdAt: '2024-01-15T10:00:00Z' },
  { id: 'svc-5', name: 'Замена тормозных дисков (ось)', category: 'Тормоза', defaultPrice: 3500, createdAt: '2024-01-15T10:00:00Z' },
  { id: 'svc-6', name: 'Диагностика подвески', category: 'Диагностика', defaultPrice: 1200, createdAt: '2024-01-15T10:00:00Z' },
  { id: 'svc-7', name: 'Компьютерная диагностика', category: 'Диагностика', defaultPrice: 2000, createdAt: '2024-01-15T10:00:00Z' },
  { id: 'svc-8', name: 'Работа Сергей', category: 'Работа мастера', defaultPrice: 5000, createdAt: '2024-01-15T10:00:00Z' },
  { id: 'svc-9', name: 'Работа Байрам', category: 'Работа мастера', defaultPrice: 5000, createdAt: '2024-01-15T10:00:00Z' },
  { id: 'svc-10', name: 'Замена амортизатора', category: 'Подвеска', defaultPrice: 3000, createdAt: '2024-01-15T10:00:00Z' },
  { id: 'svc-11', name: 'Развал-схождение', category: 'Подвеска', defaultPrice: 3500, createdAt: '2024-01-15T10:00:00Z' },
  { id: 'svc-12', name: 'Шиномонтаж (4 колеса)', category: 'Колёса', defaultPrice: 2400, createdAt: '2024-01-15T10:00:00Z' },
];

// ---- Checks ----
const today = new Date();
const d = (daysAgo: number) => {
  const dt = new Date(today);
  dt.setDate(dt.getDate() - daysAgo);
  return dt.toISOString();
};

export const demoChecks: Check[] = [
  {
    id: 'check-1',
    number: 1042,
    date: d(0),
    masterId: 'user-master-1',
    master: demoUsers[2],
    clientId: 'client-1',
    client: demoClients[0],
    carId: 'car-1',
    car: demoCars[0],
    mileage: 87500,
    comment: 'Клиент просил проверить подвеску при следующем визите',
    discount: 0,
    paymentMethod: PaymentMethod.CARD,
    services: [
      { id: 's1', name: 'Замена масла', price: 1500, quantity: 1, total: 1500 },
      { id: 's2', name: 'Замена масляного фильтра', price: 500, quantity: 1, total: 500 },
    ],
    products: [
      { id: 'p1', name: 'Масло моторное Castrol 5W-30 4L', sellPrice: 3200, costPrice: 2100, quantity: 1, totalSell: 3200, totalCost: 2100 },
      { id: 'p2', name: 'Фильтр масляный Toyota', sellPrice: 650, costPrice: 350, quantity: 1, totalSell: 650, totalCost: 350 },
    ],
    serviceTotal: 2000,
    productTotal: 3850,
    totalRevenue: 5850,
    productCostTotal: 2450,
    serviceSalaryTotal: 700,
    totalCost: 3150,
    profit: 2700,
    createdAt: d(0),
  },
  {
    id: 'check-2',
    number: 1041,
    date: d(0),
    masterId: 'user-master-2',
    master: demoUsers[3],
    clientId: 'client-3',
    client: demoClients[2],
    carId: 'car-3',
    car: demoCars[2],
    mileage: 42000,
    comment: 'Постоянный клиент, сделали скидку 10%',
    discount: 472,
    paymentMethod: PaymentMethod.CASH,
    services: [
      { id: 's3', name: 'Компьютерная диагностика', price: 2000, quantity: 1, total: 2000 },
      { id: 's4', name: 'Замена свечей зажигания', price: 1200, quantity: 1, total: 1200 },
    ],
    products: [
      { id: 'p3', name: 'Свеча зажигания NGK', sellPrice: 380, costPrice: 180, quantity: 4, totalSell: 1520, totalCost: 720 },
    ],
    serviceTotal: 3200,
    productTotal: 1520,
    totalRevenue: 4720,
    productCostTotal: 720,
    serviceSalaryTotal: 960,
    totalCost: 1680,
    profit: 3040,
    createdAt: d(0),
  },
  {
    id: 'check-3',
    number: 1040,
    date: d(1),
    masterId: 'user-master-1',
    master: demoUsers[2],
    clientId: 'client-2',
    client: demoClients[1],
    carId: 'car-2',
    car: demoCars[1],
    mileage: 55200,
    comment: 'Гарантийный ремонт тормозной системы, клиент обращался повторно',
    discount: 0,
    paymentMethod: PaymentMethod.WARRANTY,
    services: [
      { id: 's5', name: 'Замена тормозных колодок (ось)', price: 2500, quantity: 2, total: 5000 },
      { id: 's6', name: 'Замена тормозных дисков (ось)', price: 3500, quantity: 1, total: 3500 },
    ],
    products: [
      { id: 'p4', name: 'Колодки тормозные передние ATE', sellPrice: 3100, costPrice: 1800, quantity: 2, totalSell: 6200, totalCost: 3600 },
      { id: 'p5', name: 'Диски тормозные передние Brembo', sellPrice: 6800, costPrice: 4200, quantity: 1, totalSell: 6800, totalCost: 4200 },
    ],
    serviceTotal: 8500,
    productTotal: 13000,
    totalRevenue: 21500,
    productCostTotal: 7800,
    serviceSalaryTotal: 2975,
    totalCost: 10775,
    profit: 10725,
    createdAt: d(1),
  },
  {
    id: 'check-4',
    number: 1039,
    date: d(2),
    masterId: 'user-master-2',
    master: demoUsers[3],
    clientId: 'client-5',
    client: demoClients[4],
    carId: 'car-5',
    car: demoCars[4],
    mileage: 15800,
    comment: '',
    discount: 500,
    paymentMethod: PaymentMethod.CASH_CARD,
    services: [
      { id: 's7', name: 'Замена масла', price: 1500, quantity: 1, total: 1500 },
      { id: 's8', name: 'Замена воздушного фильтра', price: 400, quantity: 1, total: 400 },
      { id: 's9', name: 'Замена масляного фильтра', price: 500, quantity: 1, total: 500 },
    ],
    products: [
      { id: 'p6', name: 'Масло моторное Castrol 5W-30 4L', sellPrice: 3200, costPrice: 2100, quantity: 1, totalSell: 3200, totalCost: 2100 },
      { id: 'p7', name: 'Фильтр масляный Toyota', sellPrice: 650, costPrice: 350, quantity: 1, totalSell: 650, totalCost: 350 },
      { id: 'p8', name: 'Фильтр воздушный универсальный', sellPrice: 550, costPrice: 280, quantity: 1, totalSell: 550, totalCost: 280 },
    ],
    serviceTotal: 2400,
    productTotal: 4400,
    totalRevenue: 6800,
    productCostTotal: 2730,
    serviceSalaryTotal: 720,
    totalCost: 3450,
    profit: 3350,
    createdAt: d(2),
  },
  {
    id: 'check-5',
    number: 1038,
    date: d(3),
    masterId: 'user-master-1',
    master: demoUsers[2],
    clientId: 'client-4',
    client: demoClients[3],
    carId: 'car-4',
    car: demoCars[3],
    mileage: 68400,
    comment: 'Амортизаторы сильно изношены, рекомендовано заменить все 4',
    discount: 1000,
    paymentMethod: PaymentMethod.CASH,
    services: [
      { id: 's10', name: 'Диагностика подвески', price: 1200, quantity: 1, total: 1200 },
      { id: 's11', name: 'Замена амортизатора', price: 3000, quantity: 2, total: 6000 },
    ],
    products: [
      { id: 'p9', name: 'Амортизатор задний KYB', sellPrice: 5500, costPrice: 3500, quantity: 2, totalSell: 11000, totalCost: 7000 },
    ],
    serviceTotal: 7200,
    productTotal: 11000,
    totalRevenue: 18200,
    productCostTotal: 7000,
    serviceSalaryTotal: 2520,
    totalCost: 9520,
    profit: 8680,
    createdAt: d(3),
  },
];

// ---- Suppliers ----
export const demoSuppliers: Supplier[] = [
  { id: 'sup-1', name: 'АвтоДеталь Москва', phone: '+7 (495) 111-22-33', contactPerson: 'Виктор', totalPurchases: 285000, totalPaid: 240000, currentDebt: 45000, createdAt: '2024-01-20T10:00:00Z' },
  { id: 'sup-2', name: 'ОптМасла', phone: '+7 (495) 444-55-66', contactPerson: 'Ирина', totalPurchases: 178000, totalPaid: 178000, currentDebt: 0, createdAt: '2024-02-10T10:00:00Z' },
  { id: 'sup-3', name: 'ТормозСервис', phone: '+7 (495) 777-88-99', contactPerson: 'Павел', totalPurchases: 95000, totalPaid: 80000, currentDebt: 15000, createdAt: '2024-03-05T10:00:00Z' },
];

// ---- Dashboard stats ----
export const demoDashboardStats: DashboardStats = {
  todayRevenue: 10570,
  todayChecks: 2,
  weekRevenue: 57070,
  monthRevenue: 185400,
  todayProfit: 4230,
  monthProfit: 72150,
};

// ---- Salary ----
export const demoSalarySummary: SalarySummary = {
  today: 700,
  week: 6195,
  month: 24850,
  total: 142300,
  masterName: 'Сергей Козлов',
  salaryPercent: 35,
  todayChecks: 2,
  monthChecks: 87,
  todayCash: 4720,
  todayCard: 5850,
  todayWarranty: 0,
};

export const demoMasterSalaries: MasterSalary[] = [
  { masterId: 'user-master-1', masterName: 'Сергей Козлов', salaryPercent: 35, totalEarnings: 142300, totalRevenue: 406571, checkCount: 87 },
  { masterId: 'user-master-2', masterName: 'Дмитрий Смирнов', salaryPercent: 30, totalEarnings: 98400, totalRevenue: 328000, checkCount: 72 },
];

// ---- Financial report ----
export const demoFinancialReport: FinancialReport = {
  dateFrom: d(30),
  dateTo: d(0),
  revenue: 185400,
  productCost: 52300,
  salaries: 24850,
  grossProfit: 133100,
  netProfit: 108250,
  checkCount: 42,
};

// ---- Product categories ----
export const demoProductCategories: string[] = [
  'Масла',
  'Фильтры',
  'Тормозная система',
  'Жидкости',
  'Электрика',
  'ГРМ',
  'Подвеска',
];

// ---- Service categories ----
export const demoServiceCategories: string[] = [
  'ТО',
  'Тормоза',
  'Диагностика',
  'Двигатель',
  'Подвеска',
  'Колёса',
];
