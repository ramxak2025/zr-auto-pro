import { useEffect, useRef, useState } from 'react';
import { ImageOff, Maximize2, X } from 'lucide-react';
import { learningAssets, type LearningAsset, type LearningCaptureId } from './assets';

function Screenshot({
  asset,
  onError,
  hotspot,
}: {
  asset: LearningAsset;
  onError: () => void;
  hotspot?: LearningAsset['hotspot'];
}) {
  const target = hotspot ?? asset.hotspot;
  return (
    <span className="learning-image-content">
      <img
        src={asset.src}
        width={asset.width}
        height={asset.height}
        alt={asset.alt}
        loading="lazy"
        decoding="async"
        onError={onError}
      />
      {target && (
        <span
          aria-hidden="true"
          className="learning-hotspot"
          style={{
            left: `${target.x * 100}%`,
            top: `${target.y * 100}%`,
            width: `${target.width * 100}%`,
            height: `${target.height * 100}%`,
          }}
        />
      )}
    </span>
  );
}

export default function LearningImage({
  assetId,
  preview = false,
  hotspot,
}: {
  assetId: LearningCaptureId;
  preview?: boolean;
  hotspot?: LearningAsset['hotspot'];
}) {
  const asset = learningAssets[assetId];
  const [failed, setFailed] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const retryRef = useRef<HTMLButtonElement>(null);
  const focusRetryAfterFailure = useRef(false);

  const handleImageError = () => {
    focusRetryAfterFailure.current = expanded;
    setExpanded(false);
    setFailed(true);
  };

  useEffect(() => {
    setFailed(false);
    setExpanded(false);
  }, [assetId]);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!expanded || !dialog) return;
    const trigger = triggerRef.current;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    dialog.showModal();
    return () => {
      dialog.close();
      document.body.style.overflow = previousOverflow;
      trigger?.focus({ preventScroll: true });
    };
  }, [expanded]);

  useEffect(() => {
    if (!failed || !focusRetryAfterFailure.current) return;
    // The original image trigger is removed in the error state. Focus its recovery action.
    retryRef.current?.focus({ preventScroll: true });
    focusRetryAfterFailure.current = false;
  }, [failed]);

  if (!asset || failed) {
    return (
      <div className="learning-image-missing" role="status">
        <ImageOff size={28} aria-hidden="true" />
        <p>Скриншот не загрузился</p>
        <span>Инструкция доступна ниже. Попробуйте открыть изображение ещё раз.</span>
        {asset && (
          <button
            ref={retryRef}
            type="button"
            className="learning-button"
            aria-label="Повторить загрузку скриншота"
            onClick={() => setFailed(false)}
          >
            Повторить
          </button>
        )}
      </div>
    );
  }

  if (preview)
    return (
      <div className="learning-preview-image">
        <Screenshot asset={asset} hotspot={hotspot} onError={handleImageError} />
      </div>
    );

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        className="learning-image-button"
        onClick={() => setExpanded(true)}
        aria-label={`Увеличить скриншот: ${asset.alt}`}
        aria-haspopup="dialog"
      >
        <Screenshot asset={asset} hotspot={hotspot} onError={handleImageError} />
        <span className="learning-expand">
          <Maximize2 size={15} aria-hidden="true" /> Увеличить
        </span>
      </button>
      {expanded && (
        <dialog
          ref={dialogRef}
          className="learning-image-dialog"
          aria-label="Увеличенный учебный скриншот"
          onCancel={(event) => {
            event.preventDefault();
            setExpanded(false);
          }}
        >
          <div className="learning-dialog-toolbar">
            <p>Учебный экран · тестовые данные</p>
            <button
              type="button"
              className="learning-button"
              aria-label="Закрыть скриншот"
              onClick={() => setExpanded(false)}
            >
              <X size={20} aria-hidden="true" />
              <span>Закрыть</span>
            </button>
          </div>
          <div className="learning-dialog-image">
            <Screenshot asset={asset} hotspot={hotspot} onError={handleImageError} />
          </div>
        </dialog>
      )}
    </>
  );
}
