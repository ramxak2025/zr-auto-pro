import { useEffect, useRef, useState } from 'react';
import { ImageOff, Maximize2, MousePointer2, X } from 'lucide-react';
import { getLearningAsset, type LearningImageAsset, type LearningImageId } from './assets';
import {
  learningAnnotationGeometry,
  learningZoomScroll,
  type LearningAnnotation,
  type LearningTarget,
} from './annotation';

function Screenshot({
  asset,
  onError,
  hotspot,
  annotation,
  stepNumber,
}: {
  asset: LearningImageAsset;
  onError: () => void;
  hotspot?: LearningTarget;
  annotation?: LearningAnnotation;
  stepNumber: number;
}) {
  const frameRef = useRef<HTMLSpanElement>(null);
  const [frame, setFrame] = useState({ width: asset.width, height: asset.height });
  useEffect(() => {
    if (!frameRef.current || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(([entry]) => {
      if (entry.contentRect.width > 0 && entry.contentRect.height > 0) {
        setFrame({ width: entry.contentRect.width, height: entry.contentRect.height });
      }
    });
    observer.observe(frameRef.current);
    return () => observer.disconnect();
  }, []);
  const target = hotspot ?? asset.hotspot;
  const geometry = target && learningAnnotationGeometry(target, annotation?.placement, frame);
  return (
    <span className="learning-image-content" ref={frameRef}>
      <img
        src={asset.src}
        width={asset.width}
        height={asset.height}
        alt={asset.alt}
        loading="lazy"
        decoding="async"
        onError={onError}
      />
      {target && geometry && (
        <>
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
          <span
            aria-hidden="true"
            className="learning-target-pin"
            style={{ left: `${geometry.pin.x * 100}%`, top: `${geometry.pin.y * 100}%` }}
          >
            {annotation?.kind === 'click' && <MousePointer2 size={14} />}
            {stepNumber}
          </span>
          {annotation?.label && geometry.label && (
            <span
              aria-hidden="true"
              className={`learning-target-label is-${geometry.label.side}`}
              style={{ left: `${geometry.label.x * 100}%`, top: `${geometry.label.y * 100}%` }}
            >
              {annotation.label}
            </span>
          )}
        </>
      )}
    </span>
  );
}

export default function LearningImage({
  assetId,
  preview = false,
  hotspot,
  annotation,
  stepNumber = 1,
}: {
  assetId: LearningImageId;
  preview?: boolean;
  hotspot?: LearningTarget;
  annotation?: LearningAnnotation;
  stepNumber?: number;
}) {
  const asset = getLearningAsset(assetId);
  const [failed, setFailed] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const viewportRef = useRef<HTMLDivElement>(null);
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
    if (!expanded || asset?.provenance.platform !== 'desktop') return;
    const viewport = viewportRef.current;
    if (!viewport) return;
    // Center the step once on opening at natural scale; manual scroll does not update these dependencies.
    const position = learningZoomScroll(hotspot ?? asset.hotspot, asset, {
      width: viewport.clientWidth,
      height: viewport.clientHeight,
    });
    viewport.scrollTo({ ...position, behavior: 'instant' });
  }, [expanded, asset, hotspot]);

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
        <Screenshot
          asset={asset}
          hotspot={hotspot}
          annotation={annotation}
          stepNumber={stepNumber}
          onError={handleImageError}
        />
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
        <Screenshot
          asset={asset}
          hotspot={hotspot}
          annotation={annotation}
          stepNumber={stepNumber}
          onError={handleImageError}
        />
        <span className="learning-expand">
          <Maximize2 size={15} aria-hidden="true" /> Увеличить
        </span>
      </button>
      {expanded && (
        <dialog
          ref={dialogRef}
          className={`learning-image-dialog${asset.provenance.platform === 'desktop' ? ' is-desktop' : ''}`}
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
          <div className="learning-dialog-image" ref={viewportRef}>
            <Screenshot
              asset={asset}
              hotspot={hotspot}
              annotation={annotation}
              stepNumber={stepNumber}
              onError={handleImageError}
            />
          </div>
        </dialog>
      )}
    </>
  );
}
