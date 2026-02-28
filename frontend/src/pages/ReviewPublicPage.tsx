import { useState, useEffect } from 'react';
import { useParams } from 'react-router-dom';
import { Star, ExternalLink, Loader2, CheckCircle, XCircle } from 'lucide-react';
import { publicReviewApi } from '../api/services';
import type { PublicReviewData, ReviewPlatformLink } from '../types';

const platformLabels: Record<string, string> = {
  google: 'Google Maps',
  yandex: 'Яндекс Карты',
  '2gis': '2ГИС',
};

const platformColors: Record<string, { bg: string; text: string; border: string }> = {
  google: { bg: 'bg-blue-50', text: 'text-blue-700', border: 'border-blue-200' },
  yandex: { bg: 'bg-red-50', text: 'text-red-700', border: 'border-red-200' },
  '2gis': { bg: 'bg-green-50', text: 'text-green-700', border: 'border-green-200' },
};

export default function ReviewPublicPage() {
  const { token } = useParams<{ token: string }>();
  const [data, setData] = useState<PublicReviewData | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [rating, setRating] = useState(0);
  const [hoverRating, setHoverRating] = useState(0);
  const [comment, setComment] = useState('');
  const [submitted, setSubmitted] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [showRedirect, setShowRedirect] = useState(false);

  useEffect(() => {
    if (!token) return;
    publicReviewApi.getByToken(token)
      .then((res: any) => setData(res.data))
      .catch((err: any) => {
        const msg = err.response?.data?.message || 'Ссылка недействительна';
        setError(msg);
      })
      .finally(() => setLoading(false));
  }, [token]);

  const handleSubmit = async () => {
    if (!token || rating === 0) return;
    setSubmitting(true);
    try {
      await publicReviewApi.submit(token, { rating, comment: comment.trim() || undefined });
      setSubmitted(true);
      // If rating >= 4, show redirect options
      if (rating >= 4 && data?.platformLinks && data.platformLinks.filter(l => l.isActive).length > 0) {
        setShowRedirect(true);
      }
    } catch (err: any) {
      setError(err.response?.data?.message || 'Ошибка отправки');
    } finally {
      setSubmitting(false);
    }
  };

  const handleRedirect = async (link: ReviewPlatformLink) => {
    // Update redirectedTo via another submit won't work (token used),
    // so we just open the link
    window.open(link.url, '_blank');
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-violet-500" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center px-4">
        <div className="text-center max-w-sm">
          <XCircle className="h-16 w-16 text-red-400 mx-auto mb-4" />
          <h1 className="text-xl font-bold text-gray-900 mb-2">Ошибка</h1>
          <p className="text-sm text-gray-500">{error}</p>
        </div>
      </div>
    );
  }

  if (submitted && showRedirect) {
    const activeLinks = data?.platformLinks?.filter(l => l.isActive) || [];
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center px-4">
        <div className="w-full max-w-sm text-center">
          <CheckCircle className="h-16 w-16 text-green-500 mx-auto mb-4" />
          <h1 className="text-xl font-bold text-gray-900 mb-2">Спасибо за отзыв!</h1>
          <p className="text-sm text-gray-500 mb-6">
            Будем благодарны, если оставите отзыв на одной из площадок
          </p>
          <div className="space-y-3">
            {activeLinks.map(l => {
              const colors = platformColors[l.platform] || { bg: 'bg-gray-50', text: 'text-gray-700', border: 'border-gray-200' };
              return (
                <button
                  key={l.id}
                  onClick={() => handleRedirect(l)}
                  className={`w-full flex items-center justify-center gap-2 px-4 py-3 rounded-xl border ${colors.border} ${colors.bg} ${colors.text} font-medium text-sm hover:opacity-80 transition-opacity`}
                >
                  <ExternalLink className="h-4 w-4" />
                  {platformLabels[l.platform] || l.platform}
                </button>
              );
            })}
          </div>
        </div>
      </div>
    );
  }

  if (submitted) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center px-4">
        <div className="text-center max-w-sm">
          <CheckCircle className="h-16 w-16 text-green-500 mx-auto mb-4" />
          <h1 className="text-xl font-bold text-gray-900 mb-2">Спасибо!</h1>
          <p className="text-sm text-gray-500">Ваш отзыв отправлен. Мы ценим вашу обратную связь.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center px-4 py-8">
      <div className="w-full max-w-sm">
        {/* Header */}
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-gradient-to-br from-violet-500 to-fuchsia-500 shadow-lg shadow-violet-200 mb-4">
            <Star className="w-8 h-8 text-white" />
          </div>
          <h1 className="text-xl font-bold text-gray-900 mb-1">{data?.tenantName}</h1>
          {data?.clientName && (
            <p className="text-sm text-gray-500">
              {data.clientName}, оцените качество обслуживания
            </p>
          )}
          {!data?.clientName && (
            <p className="text-sm text-gray-500">Оцените качество обслуживания</p>
          )}
        </div>

        {/* Rating stars */}
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-6 mb-4">
          <p className="text-sm font-medium text-gray-700 text-center mb-4">Ваша оценка</p>
          <div className="flex justify-center gap-2 mb-6">
            {[1, 2, 3, 4, 5].map(i => (
              <button
                key={i}
                onClick={() => setRating(i)}
                onMouseEnter={() => setHoverRating(i)}
                onMouseLeave={() => setHoverRating(0)}
                className="transition-transform hover:scale-110 active:scale-95"
              >
                <Star
                  className={`h-10 w-10 transition-colors ${
                    i <= (hoverRating || rating)
                      ? 'fill-amber-400 text-amber-400'
                      : 'text-gray-200'
                  }`}
                />
              </button>
            ))}
          </div>
          {rating > 0 && rating <= 3 && (
            <p className="text-xs text-center text-gray-500 mb-4">
              Расскажите, что можно улучшить
            </p>
          )}
          {rating >= 4 && (
            <p className="text-xs text-center text-green-600 mb-4">
              Отлично! Спасибо за высокую оценку
            </p>
          )}

          {/* Comment */}
          {rating > 0 && (
            <textarea
              value={comment}
              onChange={e => setComment(e.target.value)}
              placeholder={rating <= 3 ? 'Что пошло не так?' : 'Оставьте комментарий (необязательно)'}
              rows={3}
              className="w-full rounded-xl border border-gray-200 px-4 py-3 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-violet-500 focus:border-transparent"
            />
          )}
        </div>

        {/* Submit */}
        {rating > 0 && (
          <button
            onClick={handleSubmit}
            disabled={submitting}
            className="w-full bg-violet-600 text-white rounded-xl py-3.5 text-sm font-semibold hover:bg-violet-700 transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
          >
            {submitting ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              'Отправить отзыв'
            )}
          </button>
        )}

        {data?.employeeName && (
          <p className="text-xs text-gray-400 text-center mt-4">
            Мастер: {data.employeeName}
          </p>
        )}
      </div>
    </div>
  );
}
