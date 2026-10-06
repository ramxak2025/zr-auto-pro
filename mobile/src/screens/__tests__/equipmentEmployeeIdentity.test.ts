import { resolveEquipmentEmployeeIdentity } from '../equipmentEmployeeIdentity';

describe('resolveEquipmentEmployeeIdentity', () => {
  it('uses the newest matching authorized summary identity over stale route params', () => {
    const routeSnapshot = { userId: 'employee-1', fullName: 'Алексей', avatar: '/old.webp', totalCost: 500 };
    const currentSummary = [
      { userId: 'employee-2', fullName: 'Борис', avatar: '/other.webp', totalCost: 700 },
      { userId: 'employee-1', fullName: 'Алексей', avatar: '/approved.webp', totalCost: 500 },
    ];

    expect(resolveEquipmentEmployeeIdentity(routeSnapshot, currentSummary).avatar).toBe('/approved.webp');
  });

  it('keeps the route snapshot when that employee is absent from the current authorized summary', () => {
    const routeSnapshot = { userId: 'employee-1', fullName: 'Алексей', avatar: '/existing.webp' };
    expect(resolveEquipmentEmployeeIdentity(routeSnapshot, []).avatar).toBe('/existing.webp');
  });
});
