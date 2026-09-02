import { useEffect } from 'react';
import { Maximize2, X } from 'lucide-react';

import type { TurnTokenSnapshot } from '../../../src/index.js';
import { TokenSunburst } from '../TokenSunburst.js';

interface TokenMapModalProps {
  onClose: () => void;
  snapshot: TurnTokenSnapshot | undefined;
}

export const TokenMapModal = ({ onClose, snapshot }: TokenMapModalProps) => {
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

  return (
    <div
      className="linear-modal-backdrop"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
      role="presentation"
    >
      <div
        aria-label="Prompt token anatomy modal"
        aria-modal="true"
        className="linear-modal-dialog"
        role="dialog"
      >
        <div className="modal-header">
          <div className="modal-title-group">
            <div className="modal-icon-badge">
              <Maximize2 size={14} />
            </div>
            <div>
              <h3 className="modal-title">Prompt Token Anatomy</h3>
              <p className="modal-subtitle">
                Hierarchical ring visualization. Outer sectors represent individual modules and
                segments.
              </p>
            </div>
          </div>

          <button
            aria-label="Close modal"
            className="modal-close-btn"
            onClick={onClose}
            type="button"
          >
            <X size={16} />
          </button>
        </div>

        <div className="modal-body">
          <TokenSunburst expanded snapshot={snapshot} />
        </div>
      </div>
    </div>
  );
};
