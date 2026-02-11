import type { InternalAxiosRequestConfig, AxiosResponse } from 'axios';
import {
  demoUser,
  demoUsers,
  demoClients,
  demoCars,
  demoProducts,
  demoServices,
  demoChecks,
  demoSuppliers,
  demoDashboardStats,
  demoSalarySummary,
  demoMasterSalaries,
  demoFinancialReport,
  demoProductCategories,
  demoServiceCategories,
} from './data';

function paginate<T>(items: T[], page = 1, limit = 20) {
  const start = (page - 1) * limit;
  return {
    data: items.slice(start, start + limit),
    total: items.length,
    page,
    limit,
  };
}

function ok(data: unknown): AxiosResponse {
  return {
    data,
    status: 200,
    statusText: 'OK',
    headers: {},
    config: {} as InternalAxiosRequestConfig,
  };
}

type RouteHandler = (url: string, config: InternalAxiosRequestConfig) => AxiosResponse | null;

const getRoutes: RouteHandler[] = [
  // Auth profile
  (url) => {
    if (url === '/api/auth/profile') return ok(demoUser);
    return null;
  },

  // Dashboard
  (url) => {
    if (url === '/api/reports/dashboard') return ok(demoDashboardStats);
    return null;
  },

  // Salary
  (url) => {
    if (url === '/api/salary/my') return ok(demoSalarySummary);
    if (url === '/api/salary/masters') return ok(demoMasterSalaries);
    if (url.match(/^\/api\/salary\/masters\/[\w-]+$/)) {
      return ok(demoSalarySummary);
    }
    if (url.match(/^\/api\/salary\/masters\/[\w-]+\/details$/)) {
      return ok(paginate(demoChecks));
    }
    if (url === '/api/salary/my/details') return ok(paginate(demoChecks.slice(0, 3)));
    return null;
  },

  // Users
  (url) => {
    if (url === '/api/users' || url.startsWith('/api/users?')) return ok(paginate(demoUsers));
    if (url === '/api/users/masters') return ok(demoUsers.filter((u) => u.role === 'master'));
    const userMatch = url.match(/^\/api\/users\/([\w-]+)$/);
    if (userMatch) return ok(demoUsers.find((u) => u.id === userMatch[1]) || demoUsers[0]);
    return null;
  },

  // Clients
  (url) => {
    // Enrich clients with their cars for display
    const enriched = demoClients.map((c) => ({
      ...c,
      cars: demoCars.filter((car) => car.clientId === c.id),
    }));

    if (url === '/api/clients' || url.startsWith('/api/clients?')) {
      // Support search by name, phone, or car plate number
      const searchParam = new URL(url, 'http://localhost').searchParams.get('search');
      if (searchParam) {
        const q = searchParam.toLowerCase();
        const filtered = enriched.filter((c) => {
          if (c.fullName.toLowerCase().includes(q)) return true;
          if (c.phone.includes(q)) return true;
          return c.cars.some((car) => car.plateNumber.toLowerCase().includes(q));
        });
        return ok(paginate(filtered));
      }
      return ok(paginate(enriched));
    }
    const clientMatch = url.match(/^\/api\/clients\/([\w-]+)$/);
    if (clientMatch) {
      const client = demoClients.find((c) => c.id === clientMatch[1]) || demoClients[0];
      return ok({
        ...client,
        cars: demoCars.filter((c) => c.clientId === client.id),
        checks: demoChecks.filter((c) => c.clientId === client.id),
      });
    }
    const statsMatch = url.match(/^\/api\/clients\/([\w-]+)\/stats$/);
    if (statsMatch) return ok({ totalPayments: 42500 });
    return null;
  },

  // Cars
  (url) => {
    if (url === '/api/cars' || url.startsWith('/api/cars?')) return ok(paginate(demoCars));
    const carMatch = url.match(/^\/api\/cars\/([\w-]+)$/);
    if (carMatch) return ok(demoCars.find((c) => c.id === carMatch[1]) || demoCars[0]);
    return null;
  },

  // Products
  (url) => {
    if (url === '/api/products/categories') return ok(demoProductCategories);
    if (url === '/api/products/low-stock') {
      return ok(demoProducts.filter((p) => p.stock <= p.minStock));
    }
    if (url === '/api/products' || url.startsWith('/api/products?')) return ok(paginate(demoProducts));
    const movMatch = url.match(/^\/api\/products\/([\w-]+)\/movements/);
    if (movMatch) return ok(paginate([]));
    const prodMatch = url.match(/^\/api\/products\/([\w-]+)$/);
    if (prodMatch) return ok(demoProducts.find((p) => p.id === prodMatch[1]) || demoProducts[0]);
    return null;
  },

  // Services
  (url) => {
    if (url === '/api/services/categories') return ok(demoServiceCategories);
    if (url === '/api/services' || url.startsWith('/api/services?')) return ok(paginate(demoServices));
    const svcMatch = url.match(/^\/api\/services\/([\w-]+)$/);
    if (svcMatch) return ok(demoServices.find((s) => s.id === svcMatch[1]) || demoServices[0]);
    return null;
  },

  // Checks
  (url) => {
    if (url === '/api/checks' || url.startsWith('/api/checks?')) return ok(paginate(demoChecks));
    const checkMatch = url.match(/^\/api\/checks\/([\w-]+)$/);
    if (checkMatch) return ok(demoChecks.find((c) => c.id === checkMatch[1]) || demoChecks[0]);
    return null;
  },

  // Suppliers
  (url) => {
    if (url === '/api/suppliers' || url.startsWith('/api/suppliers?')) return ok(paginate(demoSuppliers));
    const deliveriesMatch = url.match(/^\/api\/suppliers\/([\w-]+)\/deliveries/);
    if (deliveriesMatch) return ok(paginate([]));
    const paymentsMatch = url.match(/^\/api\/suppliers\/([\w-]+)\/payments/);
    if (paymentsMatch) return ok(paginate([]));
    const supMatch = url.match(/^\/api\/suppliers\/([\w-]+)$/);
    if (supMatch) return ok(demoSuppliers.find((s) => s.id === supMatch[1]) || demoSuppliers[0]);
    return null;
  },

  // Reports
  (url) => {
    if (url === '/api/reports/financial' || url.startsWith('/api/reports/financial?')) {
      return ok(demoFinancialReport);
    }
    if (url.startsWith('/api/reports/by-master')) return ok(demoMasterSalaries);
    if (url.startsWith('/api/reports/by-service')) return ok([]);
    if (url.startsWith('/api/reports/by-product')) return ok([]);
    return null;
  },
];

const postRoutes: RouteHandler[] = [
  // Auth login
  (url) => {
    if (url === '/api/auth/login') {
      return ok({ access_token: 'demo-token', user: demoUser });
    }
    return null;
  },

  // CRUD create operations - return first item of respective collection
  (url) => {
    if (url === '/api/clients') return ok({ ...demoClients[0], id: 'new-' + Date.now() });
    if (url === '/api/cars') return ok({ ...demoCars[0], id: 'new-' + Date.now() });
    if (url === '/api/products') return ok({ ...demoProducts[0], id: 'new-' + Date.now() });
    if (url === '/api/services') return ok({ ...demoServices[0], id: 'new-' + Date.now() });
    if (url === '/api/checks') return ok({ ...demoChecks[0], id: 'new-' + Date.now() });
    if (url === '/api/suppliers') return ok({ ...demoSuppliers[0], id: 'new-' + Date.now() });
    if (url === '/api/users') return ok({ ...demoUsers[0], id: 'new-' + Date.now() });
    if (url === '/api/uploads') return ok({ url: 'https://placehold.co/200x200/e2e8f0/64748b?text=Photo' });
    return null;
  },

  // Product stock operations
  (url) => {
    if (url.match(/^\/api\/products\/[\w-]+\/(writeoff|inventory)$/)) {
      return ok({ id: 'mov-1', type: 'writeoff', quantity: 1, stockBefore: 10, stockAfter: 9 });
    }
    return null;
  },
];

export function setupDemoInterceptor(axiosInstance: {
  interceptors: {
    request: { use: (fn: (config: InternalAxiosRequestConfig) => InternalAxiosRequestConfig | Promise<never>) => void };
  };
}) {
  axiosInstance.interceptors.request.use((config: InternalAxiosRequestConfig) => {
    const url = (config.baseURL || '') + (config.url || '');
    const method = (config.method || 'get').toLowerCase();

    let result: AxiosResponse | null = null;

    if (method === 'get') {
      for (const handler of getRoutes) {
        result = handler(url, config);
        if (result) break;
      }
    } else if (method === 'post') {
      for (const handler of postRoutes) {
        result = handler(url, config);
        if (result) break;
      }
    } else if (method === 'patch') {
      // For updates, return same data
      result = ok({ success: true });
    } else if (method === 'delete') {
      result = ok({ success: true });
    }

    if (result) {
      return Promise.reject({
        __demo: true,
        response: result,
      }) as never;
    }

    return config;
  });
}

export function setupDemoResponseInterceptor(axiosInstance: {
  interceptors: {
    response: {
      use: (
        onFulfilled: (response: AxiosResponse) => AxiosResponse,
        onRejected: (error: unknown) => unknown,
      ) => void;
    };
  };
}) {
  axiosInstance.interceptors.response.use(
    (response) => response,
    (error: any) => {
      if (error?.__demo && error?.response) {
        return Promise.resolve(error.response);
      }
      return Promise.reject(error);
    },
  );
}
