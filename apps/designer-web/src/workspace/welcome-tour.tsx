import {
  ArrowLeft,
  ArrowRight,
  ArrowUpRight,
  Check,
  Layers3,
  Megaphone,
  PanelsTopLeft,
  Search,
  Workflow,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { Button, Dialog, Kbd } from '@verbis/ui';

const steps = [0, 1, 2] as const;
export function WelcomeTour({
  open,
  step,
  onStepChange,
  onClose,
}: {
  open: boolean;
  step: number;
  onStepChange: (step: number) => void;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  return (
    <Dialog
      className="dw-tour"
      open={open}
      onOpenChange={(value) => {
        if (!value) onClose();
      }}
      title={t(`designer.workspace.tourHeadings.${step}`)}
      description={t(`designer.workspace.tour.${step}`)}
    >
      <div className="dw-tour-visual vb-brand-surface" aria-hidden="true" data-step={step}>
        <div className="dw-tour-brand">
          <Layers3 size={20} />
          <span>{t('designer.workspace.tourGuide')}</span>
        </div>
        {step === 0 && (
          <div className="dw-tour-map">
            {[
              { Icon: Megaphone, name: 'campaigns', detail: 'organize' },
              { Icon: Workflow, name: 'scripts', detail: 'design' },
              { Icon: PanelsTopLeft, name: 'screens', detail: 'compose' },
            ].map(({ Icon, name, detail }) => (
              <div className="dw-tour-node" key={name}>
                <Icon size={24} />
                <strong>{t(`designer.workspace.nav.${name}`)}</strong>
                <span>{t(`designer.workspace.tourVisual.${detail}`)}</span>
              </div>
            ))}
          </div>
        )}
        {step === 1 && (
          <div className="dw-tour-command">
            <div className="dw-tour-search">
              <Search size={18} />
              <span>{t('designer.workspace.tourVisual.search')}</span>
              <Kbd>{t('designer.workspace.commandShortcut')}</Kbd>
            </div>
            <div className="dw-tour-command-row">
              <Workflow size={18} />
              <span>{t('designer.workspace.nav.scripts')}</span>
              <ArrowRight size={16} />
            </div>
            <div className="dw-tour-command-row">
              <Megaphone size={18} />
              <span>{t('designer.workspace.new.campaigns')}</span>
              <ArrowRight size={16} />
            </div>
          </div>
        )}
        {step === 2 && (
          <div className="dw-tour-release">
            {['build', 'review', 'publish'].map((name, index) => (
              <div className="dw-tour-release-row" key={name}>
                <span className="dw-tour-check">
                  {index === 2 ? <ArrowUpRight size={16} /> : <Check size={16} />}
                </span>
                <span>{t(`designer.workspace.tourVisual.${name}`)}</span>
                <span className="dw-tour-order">{String(index + 1).padStart(2, '0')}</span>
              </div>
            ))}
          </div>
        )}
      </div>
      <div className="dw-tour-progress" role="status" aria-live="polite">
        <span>{t('designer.workspace.tourCount', { current: step + 1, total: steps.length })}</span>
        <div className="dw-tour-progress-bars" aria-hidden="true">
          {steps.map((value) => (
            <span key={value} data-active={value <= step} />
          ))}
        </div>
      </div>
      <div className="dw-tour-actions">
        <Button variant="ghost" onClick={onClose}>
          {t('designer.workspace.skip')}
        </Button>
        <div>
          <Button
            variant="ghost"
            disabled={step === 0}
            startIcon={<ArrowLeft size={16} aria-hidden />}
            onClick={() => {
              onStepChange(step - 1);
            }}
          >
            {t('designer.workspace.tourBack')}
          </Button>
          <Button
            endIcon={<ArrowRight size={16} aria-hidden />}
            onClick={() => {
              if (step === 2) onClose();
              else onStepChange(step + 1);
            }}
          >
            {t(step === 2 ? 'designer.workspace.start' : 'designer.workspace.next')}
          </Button>
        </div>
      </div>
    </Dialog>
  );
}
