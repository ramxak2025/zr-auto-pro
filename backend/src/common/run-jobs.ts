/**
 * RUN_BACKGROUND_JOBS — leader-флаг для фоновых планировщиков (cron/setInterval).
 * Default TRUE (single-replica и текущее поведение не меняются). На второй,
 * HTTP-only реплике (`backend2`) выставляется RUN_BACKGROUND_JOBS=false, чтобы
 * планируемые джобы выполнялись только на ОДНОМ процессе — иначе каждый
 * сайд-эффект (review-SMS, аналитический снапшот, авто-закрытие смен,
 * напоминания) сработал бы дважды.
 */
export const RUN_BACKGROUND_JOBS = process.env.RUN_BACKGROUND_JOBS !== 'false';
