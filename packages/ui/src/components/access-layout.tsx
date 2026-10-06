import { GitBranch, Globe2, Layers3, Pause, Play, ShieldCheck, Workflow } from 'lucide-react';
import { useId, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

import { Button } from './button.js';
import { ScriptAtlas } from './script-atlas.js';

/** Shared branded access surface; applications retain ownership of authentication. */
export function AccessLayout({ appName, children }: { appName: string; children: ReactNode }) {
  const { t, i18n } = useTranslation();
  const [paused, setPaused] = useState(false);
  const title = useId();
  const label = (key: string) => t(`common.access.${key}`);
  return (
    <main className="vb-access dw-login" data-motion={paused ? 'paused' : 'running'}>
      <section className="vb-access-art" aria-labelledby={title}>
        <div className="vb-access-brand">
          <div className="vb-access-wordmark">
            <Layers3 aria-hidden />
            <span>{t('common.productName')}</span>
          </div>
          <span className="vb-access-edition">{appName}</span>
        </div>
        <div className="vb-access-story dw-login-story">
          <p className="vb-access-stage-index">{label('loginExperience')}</p>
          <h1 id={title}>
            <span>{label('loginLead')}</span>
            <span>{label('loginAccent')}</span>
          </h1>
          <p className="vb-access-description">{label('loginDescription')}</p>
          <div className="vb-access-signal-stage">
            <ScriptAtlas paused={paused} />
          </div>
          <div className="vb-access-capabilities">
            <span>
              <Workflow size={17} aria-hidden />
              {label('loginCapabilityFlow')}
            </span>
            <span>
              <GitBranch size={17} aria-hidden />
              {label('loginCapabilityVersions')}
            </span>
            <span>
              <ShieldCheck size={17} aria-hidden />
              {label('loginCapabilityAccess')}
            </span>
          </div>
        </div>
        <div className="vb-access-art-footer">
          <span>{label('loginCraft')}</span>
          <Button
            variant="ghost"
            size="sm"
            className="vb-access-motion-toggle"
            onClick={() => {
              setPaused(!paused);
            }}
            aria-label={label(paused ? 'loginPlay' : 'loginPause')}
          >
            {paused ? <Play size={15} aria-hidden /> : <Pause size={15} aria-hidden />}
          </Button>
        </div>
      </section>
      <section className="vb-access-access" aria-label={label('loginPrivate')}>
        <div className="vb-access-access-top">
          <span>{label('loginPrivate')}</span>
          <Button
            variant="ghost"
            size="sm"
            className="vb-access-language"
            onClick={() =>
              void i18n.changeLanguage(i18n.resolvedLanguage?.startsWith('tr') ? 'en' : 'tr')
            }
            aria-label={label('loginLanguage')}
          >
            <Globe2 size={15} aria-hidden />
            {label('loginLanguageCode')}
          </Button>
        </div>
        <div className="vb-access-form">
          <p className="vb-access-form-eyebrow">{appName}</p>
          {children}
          <div className="vb-access-trust">
            <ShieldCheck size={18} aria-hidden />
            <small>{label('loginTrust')}</small>
          </div>
        </div>
        <footer className="vb-access-access-footer">
          <span>{label('loginFooter')}</span>
        </footer>
      </section>
    </main>
  );
}
