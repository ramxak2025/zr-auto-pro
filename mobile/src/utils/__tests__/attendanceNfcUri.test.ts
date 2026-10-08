import { parseAttendanceNfcUri } from '../../../../shared/utils/attendanceNfcUri';

const token = 'a'.repeat(43);

describe('attendance NFC link parser', () => {
  it('accepts only the exact approved HTTPS and app links', () => {
    expect(parseAttendanceNfcUri(`https://autexa-cloud.ru/nfc/attendance#v=1&token=${token}`)).toEqual({ token });
    expect(parseAttendanceNfcUri(`https://autexa.pw/nfc/attendance#token=${token}&v=1`)).toEqual({ token });
    expect(parseAttendanceNfcUri(`autexa://nfc/attendance#v=1&token=${token}`)).toEqual({ token });
  });

  it('rejects untrusted authority, path, query, fragments, versions, duplicates and malformed tokens', () => {
    const invalid = [
      `https://user@autexa-cloud.ru/nfc/attendance#v=1&token=${token}`,
      `https://autexa-cloud.ru:443/nfc/attendance#v=1&token=${token}`,
      `https://autexa-cloud.ru.evil/nfc/attendance#v=1&token=${token}`,
      `https://autexa-cloud.ru/nfc/attendance/extra#v=1&token=${token}`,
      `https://autexa-cloud.ru/nfc/attendance?token=${token}#v=1&token=${token}`,
      `https://autexa-cloud.ru/nfc/attendance#v=1&token=${token}&token=${token}`,
      `https://autexa-cloud.ru/nfc/attendance#v=1&version=1&token=${token}`,
      `https://autexa-cloud.ru/nfc/attendance#v=2&token=${token}`,
      `https://autexa-cloud.ru/nfc/attendance#v=1&token=${'a'.repeat(42)}`,
      `autexa://other/attendance#v=1&token=${token}`,
    ];
    for (const uri of invalid) expect(parseAttendanceNfcUri(uri)).toBeNull();
  });
});
