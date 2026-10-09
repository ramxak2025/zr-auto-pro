import { BadRequestException } from '@nestjs/common';

export type AttendanceMode = 'admin' | 'manual' | 'nfc';

export function resolveAttendanceModePatch(input: {
  attendanceMode?: AttendanceMode;
  shiftsEnabled?: boolean;
}): { attendanceMode: AttendanceMode; shiftsEnabled: boolean } | undefined {
  if (input.attendanceMode === undefined && input.shiftsEnabled === undefined) return undefined;
  const attendanceMode = input.attendanceMode ?? (input.shiftsEnabled ? 'manual' : 'admin');
  const shiftsEnabled = attendanceMode !== 'admin';
  if (input.shiftsEnabled !== undefined && input.shiftsEnabled !== shiftsEnabled) {
    throw new BadRequestException({ message: 'Режим учёта присутствия не совпадает с настройкой смен' });
  }
  return { attendanceMode, shiftsEnabled };
}
