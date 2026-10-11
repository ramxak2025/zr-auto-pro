export function isPublicSessionLandingPath(pathname) {
  const parts = pathname.split('/').filter(Boolean);
  // Fixed app paths win over /:publicCode. Reserve new matching fixed routes here
  // and in the booking generator/migration before adding them to App.tsx.
  const reservedBookingCodes = new Set(['company-settings']);
  return (
    (parts.length === 1 &&
      /^(?:[A-Za-z0-9_-]{16}|[a-f0-9]{32})$/.test(parts[0]) &&
      !reservedBookingCodes.has(parts[0].toLowerCase())) ||
    (parts.length === 2 && parts[0].toLowerCase() === 'book' && parts[1].length > 0) ||
    (parts.length === 2 && parts[0].toLowerCase() === 'nfc' && parts[1].toLowerCase() === 'attendance')
  );
}
