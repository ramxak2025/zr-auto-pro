export function isPublicSessionLandingPath(pathname) {
  const parts = pathname.split('/').filter(Boolean);
  return (
    (parts.length === 2 && parts[0].toLowerCase() === 'book' && parts[1].length > 0) ||
    (parts.length === 2 && parts[0].toLowerCase() === 'nfc' && parts[1].toLowerCase() === 'attendance')
  );
}
