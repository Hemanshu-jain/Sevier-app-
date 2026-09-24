import { useEffect, useId, useRef } from 'react';
import type { ReactNode } from 'react';
import { X } from 'lucide-react';

function Modal({ title, children, onClose }: { title: string; children: ReactNode; onClose: () => void }) {
  const titleId = useId();
  const modalRef = useRef<HTMLElement>(null);

  useEffect(() => {
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    modalRef.current?.querySelector<HTMLElement>('input, select, textarea, button')?.focus();
    const closeOnEscape = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose(); };
    window.addEventListener('keydown', closeOnEscape);
    return () => { window.removeEventListener('keydown', closeOnEscape); previousFocus?.focus(); };
  }, [onClose]);

  return <div className="modal-backdrop" role="presentation"><section ref={modalRef} className="modal" role="dialog" aria-modal="true" aria-labelledby={titleId}><div className="modal-heading"><div><p className="eyebrow">Finance-controlled workflow</p><h2 id={titleId}>{title}</h2></div><button className="close-button" type="button" onClick={onClose} aria-label={`Close ${title}`}><X size={18} /></button></div>{children}</section></div>;
}

export default Modal;
