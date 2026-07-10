import { useEffect, useState } from 'react';
import Modal from './Modal';
import RegisterForm from './RegisterForm';

interface RegisterModalProps {
  isOpen: boolean;
  onClose: () => void;
}

/**
 * B2B «Заявка на подключение автосервиса» in a modal — the entry point from the
 * login screen. Not self-serve consumer signup: the form goes through the
 * moderated `registrationApi.submit` pipeline (manager/superadmin approves).
 * The form itself (fields / validation / submit / success) lives in the shared
 * `RegisterForm`, reused by the standalone `/register` page. This wrapper only
 * supplies the Modal chrome, swaps the header title on success, and provides the
 * modal-specific action buttons (Отмена / Вернуться ко входу).
 */
export default function RegisterModal({ isOpen, onClose }: RegisterModalProps) {
  const [submitted, setSubmitted] = useState(false);

  // Fresh title every time the modal opens: RegisterForm remounts (Modal drops
  // its children while closed) so it starts on the form — keep the header in sync.
  useEffect(() => {
    if (isOpen) setSubmitted(false);
  }, [isOpen]);

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={submitted ? 'Заявка отправлена' : 'Заявка на подключение автосервиса'}
      size="md"
    >
      <RegisterForm
        onSubmittedChange={setSubmitted}
        footerSecondary={
          <button type="button" onClick={onClose} className="btn-secondary">
            Отмена
          </button>
        }
        successActions={
          <button type="button" onClick={onClose} className="btn-primary w-full">
            Вернуться ко входу
          </button>
        }
      />
    </Modal>
  );
}
