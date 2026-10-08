import { useEffect, useState } from 'react';
import { parseAttendanceNfcUri } from '../../../shared/utils/attendanceNfcUri';

export default function NfcAttendanceLandingPage() {
  const [token] = useState(() => {
    if (typeof window === 'undefined') return null;
    return parseAttendanceNfcUri(window.location.href)?.token ?? null;
  });
  const [opened, setOpened] = useState(false);

  useEffect(() => {
    // The static tag opens this page with its bearer in the fragment. Keep it
    // only in component memory and remove it from the address/history entry.
    if (window.location.hash) {
      window.history.replaceState(window.history.state, '', '/nfc/attendance');
    }
  }, []);

  const openAutexa = () => {
    if (!token) return;
    setOpened(true);
    window.location.href = `autexa://nfc/attendance#v=1&token=${token}`;
  };

  return (
    <main className="min-h-screen bg-slate-50 px-5 py-16 text-slate-900">
      <section className="mx-auto max-w-lg rounded-3xl border border-slate-200 bg-white p-7 shadow-sm sm:p-10">
        <div className="mb-8 flex items-center gap-3">
          <div className="grid h-11 w-11 place-items-center rounded-2xl bg-blue-600 text-xl font-bold text-white">
            A
          </div>
          <span className="text-lg font-semibold tracking-tight">Autexa</span>
        </div>
        <p className="mb-2 text-sm font-semibold uppercase tracking-wide text-blue-700">Рабочая смена</p>
        <h1 className="text-3xl font-bold tracking-tight">Продолжите в приложении</h1>
        <p className="mt-4 text-base leading-7 text-slate-600">
          Чтобы подтвердить отметку по NFC, откройте Autexa и проверьте выбранный автосервис перед действием.
        </p>
        {token ? (
          <button
            type="button"
            onClick={openAutexa}
            className="mt-8 w-full rounded-xl bg-blue-600 px-5 py-4 text-base font-semibold text-white transition hover:bg-blue-700 focus:outline-none focus:ring-4 focus:ring-blue-200"
          >
            {opened ? 'Открываем Autexa…' : 'Открыть Autexa'}
          </button>
        ) : (
          <p className="mt-8 rounded-xl bg-slate-100 p-4 text-sm leading-6 text-slate-600">
            Ссылка метки недействительна. Вернитесь и снова приложите рабочую NFC-метку.
          </p>
        )}
        <p className="mt-5 text-sm leading-6 text-slate-500">
          Если приложение не открылось, установите Autexa или отсканируйте метку телефоном с поддержкой NFC. Эта
          страница не меняет состояние смены.
        </p>
      </section>
    </main>
  );
}
