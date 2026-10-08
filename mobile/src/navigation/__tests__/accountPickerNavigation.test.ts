import { createMoreTabPressHandlers, openAccountPicker } from '../accountPickerNavigation';

it('keeps a normal More tap intact and a long press opens the account sheet without navigating normally', () => {
  const state = { current: false };
  const normalPress = jest.fn();
  const openPicker = jest.fn();
  const handlers = createMoreTabPressHandlers(state, normalPress, openPicker);

  handlers.onPressIn();
  handlers.onPress();
  expect(normalPress).toHaveBeenCalledTimes(1);
  expect(openPicker).not.toHaveBeenCalled();

  handlers.onPressIn();
  handlers.onLongPress();
  handlers.onPress();
  expect(openPicker).toHaveBeenCalledTimes(1);
  expect(normalPress).toHaveBeenCalledTimes(1);
});

it('targets the More home with a unique request so an unopened stack can display the picker', () => {
  const dispatch = jest.fn();
  openAccountPicker({ dispatch });
  const first = dispatch.mock.calls[0][0] as {
    payload: { name: string; params: { params: { accountPickerRequest: number } } };
  };
  openAccountPicker({ dispatch });
  const second = dispatch.mock.calls[1][0] as { payload: { params: { params: { accountPickerRequest: number } } } };
  expect(first.payload.name).toBe('MoreTab');
  expect(first.payload.params).toMatchObject({ screen: 'MoreHome' });
  expect(second.payload.params.params.accountPickerRequest).toBeGreaterThan(
    first.payload.params.params.accountPickerRequest,
  );
});
