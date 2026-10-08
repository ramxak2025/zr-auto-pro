import { scrubNfcTelemetryValue } from '../utils/nfcTelemetryRedaction';

describe('NFC telemetry redaction', () => {
  it('removes tag bearer values from matching URLs, object fields, and serialized request bodies', () => {
    const token = 'a'.repeat(43);
    const value = scrubNfcTelemetryValue({
      url: `https://autexa.pw/nfc/attendance#v=1&token=${token}`,
      request_body: JSON.stringify({ token, ndefUri: `https://autexa.pw/nfc/attendance#v=1&token=${token}` }),
    });

    expect(JSON.stringify(value)).not.toContain(token);
    expect(JSON.stringify(value)).toContain('[redacted]');
  });
});
