import { createNfcOperationLeaseController } from '../nfcOperationLease';

describe('NFC native operation leases', () => {
  it('invalidates an in-flight operation when the screen blurs before native resolution', () => {
    const controller = createNfcOperationLeaseController();
    const operation = controller.begin(() => true);
    controller.invalidate();
    expect(operation.isCurrent()).toBe(false);
  });

  it('prevents an older scan from becoming current when a later scan starts', () => {
    const controller = createNfcOperationLeaseController();
    const first = controller.begin(() => true);
    const second = controller.begin(() => true);
    expect(first.isCurrent()).toBe(false);
    expect(second.isCurrent()).toBe(true);
  });
});
