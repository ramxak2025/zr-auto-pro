import { useEffect, useRef, useState } from 'react';
import { Share2 } from 'lucide-react';
import toast from 'react-hot-toast';
import { productsApi } from '../../api/services';
import { Button } from '../../ui/Button';
import { Input } from '../../ui/Input';

export default function ProductShareButton({ id, name }: { id: string; name: string }) {
  const [busy, setBusy] = useState(false);
  const [url, setUrl] = useState('');
  const sequence = useRef({ value: 0 });
  useEffect(() => {
    const owner = sequence.current;
    owner.value++;
    setUrl('');
    setBusy(false);
    return () => {
      owner.value++;
    };
  }, [id]);
  const share = async () => {
    if (busy) return;
    const attempt = ++sequence.current.value;
    let prepared = false;
    setBusy(true);
    try {
      const path = url || (await productsApi.createShare(id)).data.path;
      if (attempt !== sequence.current.value) return;
      const link = new URL(path, import.meta.env.VITE_PUBLIC_WEB_URL || window.location.origin).href;
      setUrl(link);
      prepared = true;
      if (navigator.share) await navigator.share({ title: name, url: link });
      else {
        await navigator.clipboard.writeText(link);
        toast.success('Ссылка скопирована');
      }
    } catch (error) {
      if (!(error instanceof DOMException && error.name === 'AbortError'))
        toast.error(prepared ? 'Скопируйте ссылку из поля ниже.' : 'Не удалось создать ссылку. Попробуйте ещё раз.');
    } finally {
      if (attempt === sequence.current.value) setBusy(false);
    }
  };
  return (
    <div className="space-y-2">
      <Button variant="secondary" icon={Share2} loading={busy} onClick={() => void share()}>
        Поделиться
      </Button>
      {url && (
        <div className="space-y-2">
          <Input aria-label="Ссылка на товар" readOnly value={url} onFocus={(event) => event.currentTarget.select()} />
          <Button
            variant="ghost"
            size="sm"
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              try {
                await productsApi.revokeShare(id);
                setUrl('');
                toast.success('Ссылки отозваны');
              } catch {
                toast.error('Не удалось отозвать ссылки');
              } finally {
                setBusy(false);
              }
            }}
          >
            Отозвать ссылки
          </Button>
        </div>
      )}
    </div>
  );
}
