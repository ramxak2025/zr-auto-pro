import {
  processPlateInput,
  formatPlateDisplay,
  formatMain,
  splitPlate,
  isValidPlate,
  isRussianInput,
  PLATE_MAX_LENGTH,
} from '../plateMask';

describe('processPlateInput', () => {
  it('converts Latin to Cyrillic', () => {
    expect(processPlateInput('a123bc77')).toBe('А123ВС77');
  });

  it('accepts valid Cyrillic input', () => {
    expect(processPlateInput('А123ВС77')).toBe('А123ВС77');
  });

  it('rejects invalid characters at wrong positions', () => {
    // digit at position 0 (should be letter)
    expect(processPlateInput('1')).toBe('');
    // letter at positions 1-3 (should be digits)
    expect(processPlateInput('АА')).toBe('А');
  });

  it('enforces max length', () => {
    expect(processPlateInput('А123АА777EXTRA')).toBe('А123АА777');
    expect(processPlateInput('А123АА777').length).toBe(PLATE_MAX_LENGTH);
  });

  it('handles mixed valid/invalid', () => {
    // Z skipped at digit pos, B skipped at digit pos, 7 at letter pos → stops
    expect(processPlateInput('A1Z2B3C7')).toBe('А123С');
  });

  it('handles 3-digit region', () => {
    expect(processPlateInput('А123АА177')).toBe('А123АА177');
  });

  it('handles partial input', () => {
    expect(processPlateInput('А')).toBe('А');
    expect(processPlateInput('А12')).toBe('А12');
    expect(processPlateInput('А123')).toBe('А123');
    expect(processPlateInput('А123А')).toBe('А123А');
    expect(processPlateInput('А123АА')).toBe('А123АА');
  });

  it('returns empty for completely invalid', () => {
    expect(processPlateInput('123')).toBe('');
    expect(processPlateInput('ZZZ')).toBe('');
  });
});

describe('formatPlateDisplay', () => {
  it('formats full plate', () => {
    expect(formatPlateDisplay('А123АА77')).toBe('А 123 АА 77');
  });

  it('formats 3-digit region', () => {
    expect(formatPlateDisplay('А123АА177')).toBe('А 123 АА 177');
  });

  it('formats partial input', () => {
    expect(formatPlateDisplay('')).toBe('');
    expect(formatPlateDisplay('А')).toBe('А');
    expect(formatPlateDisplay('А1')).toBe('А 1');
    expect(formatPlateDisplay('А12')).toBe('А 12');
    expect(formatPlateDisplay('А123')).toBe('А 123');
    expect(formatPlateDisplay('А123А')).toBe('А 123 А');
    expect(formatPlateDisplay('А123АА')).toBe('А 123 АА');
    expect(formatPlateDisplay('А123АА7')).toBe('А 123 АА 7');
  });
});

describe('backspace simulation', () => {
  it('deletes chars right-to-left seamlessly', () => {
    let plate = 'А123АА77';

    // 8 backspaces should reduce one char at a time
    plate = plate.slice(0, -1); // А123АА7
    expect(formatPlateDisplay(plate)).toBe('А 123 АА 7');

    plate = plate.slice(0, -1); // А123АА
    expect(formatPlateDisplay(plate)).toBe('А 123 АА');

    plate = plate.slice(0, -1); // А123А
    expect(formatPlateDisplay(plate)).toBe('А 123 А');

    plate = plate.slice(0, -1); // А123
    expect(formatPlateDisplay(plate)).toBe('А 123');

    plate = plate.slice(0, -1); // А12
    expect(formatPlateDisplay(plate)).toBe('А 12');

    plate = plate.slice(0, -1); // А1
    expect(formatPlateDisplay(plate)).toBe('А 1');

    plate = plate.slice(0, -1); // А
    expect(formatPlateDisplay(plate)).toBe('А');

    plate = plate.slice(0, -1); // empty
    expect(formatPlateDisplay(plate)).toBe('');
  });
});

describe('splitPlate', () => {
  it('splits into main + region', () => {
    expect(splitPlate('А123АА77')).toEqual({ main: 'А123АА', region: '77' });
  });

  it('handles no region', () => {
    expect(splitPlate('А123АА')).toEqual({ main: 'А123АА', region: '' });
  });

  it('handles 3-digit region', () => {
    expect(splitPlate('А123АА177')).toEqual({ main: 'А123АА', region: '177' });
  });
});

describe('formatMain', () => {
  it('formats full main part', () => {
    expect(formatMain('А123АА')).toBe('А 123 АА');
  });

  it('handles partial', () => {
    expect(formatMain('А123')).toBe('А 123');
    expect(formatMain('А')).toBe('А');
  });
});

describe('isValidPlate', () => {
  it('validates correct plates', () => {
    expect(isValidPlate('А123АА77')).toBe(true);
    expect(isValidPlate('О999НН177')).toBe(true);
  });

  it('rejects invalid', () => {
    expect(isValidPlate('А12АА77')).toBe(false); // only 2 digits
    expect(isValidPlate('Д123АА77')).toBe(false); // Д not valid
    expect(isValidPlate('')).toBe(false);
    expect(isValidPlate('А123АА7')).toBe(false); // region 1 digit
  });
});

describe('isRussianInput', () => {
  it('detects Cyrillic start', () => {
    expect(isRussianInput('А')).toBe(true);
    expect(isRussianInput('В123')).toBe(true);
  });

  it('detects Latin that maps to Cyrillic', () => {
    expect(isRussianInput('A')).toBe(true);
    expect(isRussianInput('B123')).toBe(true);
  });

  it('rejects non-plate starts', () => {
    expect(isRussianInput('1')).toBe(false);
    expect(isRussianInput('Z')).toBe(false);
    expect(isRussianInput('')).toBe(false);
  });
});
