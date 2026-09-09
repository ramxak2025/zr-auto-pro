import { extractApiErrorMessage } from '../apiError';

const axiosError = (data: unknown, message = 'Request failed with status code 400') => ({
  response: { status: 400, data },
  message,
});

describe('extractApiErrorMessage', () => {
  it('берёт русский текст нашего BadRequestException', () => {
    expect(extractApiErrorMessage(axiosError({ message: 'Остаток не может быть отрицательным' }), 'fallback')).toBe(
      'Остаток не может быть отрицательным',
    );
  });

  it('склеивает массив нарушений class-validator', () => {
    expect(extractApiErrorMessage(axiosError({ message: ['Остаток не может быть отрицательным'] }), 'fallback')).toBe(
      'Остаток не может быть отрицательным',
    );
    expect(extractApiErrorMessage(axiosError({ message: ['a', 'b'] }), 'fallback')).toBe('a\nb');
  });

  it('понимает голый текст прокси и поле error', () => {
    expect(extractApiErrorMessage(axiosError('502 Bad Gateway'), 'fallback')).toBe('502 Bad Gateway');
    expect(extractApiErrorMessage(axiosError({ error: 'Forbidden' }), 'fallback')).toBe('Forbidden');
  });

  it('падает на сетевой текст axios, затем на fallback', () => {
    expect(extractApiErrorMessage(axiosError({}, 'Network Error'), 'fallback')).toBe('Network Error');
    expect(extractApiErrorMessage({}, 'Не удалось обновить товар')).toBe('Не удалось обновить товар');
  });
});
