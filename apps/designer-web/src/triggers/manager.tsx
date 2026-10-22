import { AudioLines, Plus, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import {
  TRIGGER_LIMITS,
  type ScriptDocument,
  type ScriptTrigger,
  type TriggerAction,
} from '@verbis/script-schema';
import {
  Alert,
  Button,
  EmptyState,
  Input,
  MultiSelect,
  Select,
  Switch,
  Textarea,
} from '@verbis/ui';

import { useEditor, type EditorStore } from '../editor/store.js';

import './styles.css';

import {
  actionMessageKeys,
  alertKey,
  dropMessages,
  flowPages,
  newTrigger,
  newTriggerId,
  noticeChoices,
  parsePhrases,
  scriptLocales,
  tryTriggers,
} from './model.js';

const SPEAKERS = ['customer', 'agent', 'any'] as const;
const ACTION_TYPES = ['suggestPage', 'alert', 'markNotice'] as const;
const TONES = ['info', 'success', 'warning', 'danger'] as const;

/**
 * Conversation triggers (ADR-0052): phrases the live transcript listens for and what the agent is
 * offered when one is heard. Everything is a suggestion; nothing moves the call by itself.
 */
export function TriggerManager({
  store,
  readOnly = false,
}: {
  store: EditorStore;
  readOnly?: boolean;
}) {
  const state = useEditor(store),
    { t } = useTranslation();
  const triggers = state.document.triggers ?? [];
  const [selected, setSelected] = useState(triggers[0]?.id ?? '');
  const trigger = triggers.find((candidate) => candidate.id === selected) ?? triggers[0];
  const update = (recipe: (draft: ScriptTrigger, document: ScriptDocument) => void) => {
    if (readOnly || !trigger) return;
    store.execute(() => {
      store.edit((d) => {
        const current = d.triggers?.find((candidate) => candidate.id === trigger.id);
        if (current) recipe(current, d);
      });
    });
  };
  return (
    <section className="fd-manager">
      <div className="rb-manager-content">
        <header className="fd-manager-head">
          <div>
            <h2>{t('designer.triggers.title')}</h2>
            <p>{t('designer.triggers.intro')}</p>
          </div>
          <Button
            disabled={readOnly || triggers.length >= TRIGGER_LIMITS.maxTriggers}
            onClick={() => {
              const document = store.getSnapshot().document;
              const id = newTriggerId(document, () => crypto.randomUUID().slice(0, 8));
              const created = newTrigger(
                document,
                id,
                t('designer.triggers.defaultName', { number: triggers.length + 1 }),
              );
              store.execute(() => {
                store.edit((d) => {
                  (d.triggers ??= []).push(created);
                  for (const key of actionMessageKeys(created.actions))
                    for (const messages of Object.values(d.i18n.messages)) messages[key] = '';
                });
              });
              setSelected(id);
            }}
          >
            <Plus size={16} aria-hidden />
            {t('designer.triggers.add')}
          </Button>
        </header>
        {triggers.length === 0 ? (
          <EmptyState
            icon={<AudioLines size={24} />}
            title={t('designer.triggers.emptyTitle')}
            description={t('designer.triggers.emptyBody')}
          />
        ) : (
          <div className="rb-manager-toolbar">
            <Select
              label={t('designer.triggers.title')}
              value={trigger?.id ?? ''}
              options={triggers.map((candidate) => ({
                value: candidate.id,
                label: candidate.enabled
                  ? candidate.name
                  : t('designer.triggers.disabledName', { name: candidate.name }),
              }))}
              onValueChange={setSelected}
            />
          </div>
        )}
        {trigger && (
          <TriggerForm
            key={trigger.id}
            trigger={trigger}
            document={state.document}
            readOnly={readOnly}
            update={update}
            onRemove={() => {
              store.execute(() => {
                store.edit((d) => {
                  d.triggers = (d.triggers ?? []).filter((c) => c.id !== trigger.id);
                  dropMessages(d, actionMessageKeys(trigger.actions));
                });
              });
              setSelected(triggers.find((c) => c.id !== trigger.id)?.id ?? '');
            }}
          />
        )}
        {triggers.length > 0 && <TryBox document={state.document} />}
        {state.message && <Alert title={t(state.message)} tone="danger" />}
      </div>
    </section>
  );
}

function TriggerForm({
  trigger,
  document,
  readOnly,
  update,
  onRemove,
}: {
  trigger: ScriptTrigger;
  document: ScriptDocument;
  readOnly: boolean;
  update: (recipe: (draft: ScriptTrigger, document: ScriptDocument) => void) => void;
  onRemove: () => void;
}) {
  const { t } = useTranslation();
  const locales = scriptLocales(document);
  // Raw text per locale: a half-typed line must survive until it holds a phrase.
  const [drafts, setDrafts] = useState<Record<string, string>>(() =>
    Object.fromEntries(locales.map((l) => [l, (trigger.phrases[l] ?? []).join('\n')])),
  );
  const pages = flowPages(document);
  const notices = noticeChoices(document);
  const cooldown = trigger.repeat === 'once' ? null : trigger.repeat.cooldownSeconds;
  return (
    <fieldset disabled={readOnly} className="tg-form">
      <Input
        label={t('designer.triggers.name')}
        value={trigger.name}
        maxLength={120}
        onChange={(event) => {
          const name = event.target.value;
          if (name.trim()) update((draft) => void (draft.name = name));
        }}
      />
      <Switch
        label={t('designer.triggers.enabled')}
        checked={trigger.enabled}
        disabled={readOnly}
        onCheckedChange={(enabled) => {
          update((draft) => void (draft.enabled = enabled));
        }}
      />
      {locales.map((locale) => (
        <Textarea
          key={locale}
          label={t('designer.triggers.phrases', { locale: locale.toLocaleUpperCase('tr') })}
          hint={t('designer.triggers.phrasesHint')}
          rows={4}
          value={drafts[locale] ?? ''}
          onChange={(event) => {
            const text = event.target.value;
            setDrafts((current) => ({ ...current, [locale]: text }));
            update((draft) => void (draft.phrases[locale] = parsePhrases(text)));
          }}
        />
      ))}
      <Select
        label={t('designer.triggers.speaker')}
        value={trigger.speaker}
        disabled={readOnly}
        options={SPEAKERS.map((value) => ({
          value,
          label: t(`designer.triggers.speakers.${value}`),
        }))}
        onValueChange={(value) => {
          const speaker = SPEAKERS.find((s) => s === value);
          if (speaker) update((draft) => void (draft.speaker = speaker));
        }}
      />
      <MultiSelect
        label={t('designer.triggers.pages')}
        value={trigger.pages ?? []}
        disabled={readOnly}
        options={document.pages.map((page) => ({ value: page.id, label: page.name }))}
        onValueChange={(value) => {
          update((draft) => {
            if (value.length === 0) delete draft.pages;
            else draft.pages = value;
          });
        }}
      />
      <p className="tg-hint">{t('designer.triggers.pagesHint')}</p>
      <div className="tg-row">
        <Select
          label={t('designer.triggers.repeat')}
          value={cooldown === null ? 'once' : 'cooldown'}
          disabled={readOnly}
          options={['once', 'cooldown'].map((value) => ({
            value,
            label: t(`designer.triggers.repeats.${value}`),
          }))}
          onValueChange={(value) => {
            update(
              (draft) => void (draft.repeat = value === 'once' ? 'once' : { cooldownSeconds: 60 }),
            );
          }}
        />
        {cooldown !== null && (
          <Input
            type="number"
            label={t('designer.triggers.cooldown')}
            min={10}
            max={3_600}
            value={cooldown}
            onChange={(event) => {
              const seconds = Math.round(Number(event.target.value));
              if (Number.isFinite(seconds) && seconds >= 10 && seconds <= 3_600)
                update((draft) => void (draft.repeat = { cooldownSeconds: seconds }));
            }}
          />
        )}
      </div>
      <h3 className="tg-subhead">{t('designer.triggers.actions')}</h3>
      <ol className="tg-actions">
        {trigger.actions.map((action, index) => (
          <li key={`${action.type}-${String(index)}`}>
            <ActionEditor
              action={action}
              triggerId={trigger.id}
              index={index}
              document={document}
              locales={locales}
              pages={pages}
              notices={notices}
              readOnly={readOnly}
              canRemove={trigger.actions.length > 1}
              onChange={(next, messages) => {
                update((draft, d) => {
                  const previous = draft.actions[index];
                  if (previous?.type === 'alert' && next.type !== 'alert')
                    dropMessages(d, [previous.messageKey]);
                  draft.actions[index] = next;
                  if (next.type === 'alert')
                    for (const locale of locales) {
                      const catalog = (d.i18n.messages[locale] ??= {});
                      catalog[next.messageKey] =
                        messages?.[locale] ?? catalog[next.messageKey] ?? '';
                    }
                });
              }}
              onRemove={() => {
                update((draft, d) => {
                  dropMessages(d, actionMessageKeys([action]));
                  draft.actions.splice(index, 1);
                });
              }}
            />
          </li>
        ))}
      </ol>
      <div className="tg-row">
        <Button
          variant="secondary"
          disabled={readOnly || trigger.actions.length >= TRIGGER_LIMITS.maxActions}
          onClick={() => {
            update((draft, d) => {
              const messageKey = alertKey(d, draft.id);
              draft.actions.push({ type: 'alert', messageKey, tone: 'info' });
              for (const locale of locales) (d.i18n.messages[locale] ??= {})[messageKey] = '';
            });
          }}
        >
          <Plus size={16} aria-hidden />
          {t('designer.triggers.addAction')}
        </Button>
        <Button variant="danger" disabled={readOnly} onClick={onRemove}>
          <Trash2 size={16} aria-hidden />
          {t('designer.triggers.remove')}
        </Button>
      </div>
    </fieldset>
  );
}

function ActionEditor({
  action,
  triggerId,
  index,
  document,
  locales,
  pages,
  notices,
  readOnly,
  canRemove,
  onChange,
  onRemove,
}: {
  action: TriggerAction;
  triggerId: string;
  index: number;
  document: ScriptDocument;
  locales: readonly string[];
  pages: readonly { id: string; name: string }[];
  notices: readonly { id: string; name: string }[];
  readOnly: boolean;
  canRemove: boolean;
  onChange: (action: TriggerAction, messages?: Record<string, string>) => void;
  onRemove: () => void;
}) {
  const { t } = useTranslation();
  const number = index + 1;
  return (
    <div className="tg-action" role="group" aria-label={t('designer.triggers.action', { number })}>
      <Select
        label={t('designer.triggers.actionType', { number })}
        value={action.type}
        disabled={readOnly}
        options={ACTION_TYPES.map((value) => ({
          value,
          label: t(`designer.triggers.types.${value}`),
        }))}
        onValueChange={(value) => {
          if (value === action.type) return;
          if (value === 'alert')
            onChange({ type: 'alert', messageKey: alertKey(document, triggerId), tone: 'info' });
          else if (value === 'suggestPage')
            onChange({ type: 'suggestPage', pageId: pages[0]?.id ?? '' });
          else if (value === 'markNotice')
            onChange({ type: 'markNotice', noticeId: notices[0]?.id ?? '' });
        }}
      />
      {action.type === 'suggestPage' &&
        (pages.length === 0 ? (
          <p className="tg-hint">{t('designer.triggers.noFlowPages')}</p>
        ) : (
          <Select
            label={t('designer.triggers.page')}
            value={action.pageId}
            disabled={readOnly}
            options={pages.map((page) => ({ value: page.id, label: page.name }))}
            onValueChange={(pageId) => {
              onChange({ type: 'suggestPage', pageId });
            }}
          />
        ))}
      {action.type === 'markNotice' &&
        (notices.length === 0 ? (
          <p className="tg-hint">{t('designer.triggers.noNotices')}</p>
        ) : (
          <Select
            label={t('designer.triggers.notice')}
            value={action.noticeId}
            disabled={readOnly}
            options={notices.map((notice) => ({ value: notice.id, label: notice.name }))}
            onValueChange={(noticeId) => {
              onChange({ type: 'markNotice', noticeId });
            }}
          />
        ))}
      {action.type === 'alert' && (
        <>
          {locales.map((locale) => (
            <Textarea
              key={locale}
              label={t('designer.triggers.message', { locale: locale.toLocaleUpperCase('tr') })}
              rows={2}
              maxLength={500}
              value={document.i18n.messages[locale]?.[action.messageKey] ?? ''}
              onChange={(event) => {
                onChange(action, {
                  ...Object.fromEntries(
                    locales.map((l) => [l, document.i18n.messages[l]?.[action.messageKey] ?? '']),
                  ),
                  [locale]: event.target.value,
                });
              }}
            />
          ))}
          <Select
            label={t('designer.triggers.tone')}
            value={action.tone}
            disabled={readOnly}
            options={TONES.map((value) => ({
              value,
              label: t(`designer.triggers.tones.${value}`),
            }))}
            onValueChange={(value) => {
              const tone = TONES.find((candidate) => candidate === value);
              if (tone) onChange({ ...action, tone });
            }}
          />
        </>
      )}
      {canRemove && (
        <Button variant="ghost" size="sm" disabled={readOnly} onClick={onRemove}>
          {t('designer.triggers.removeAction', { number })}
        </Button>
      )}
    </div>
  );
}

/** "Try a sentence": the same matcher the call uses, without page scope or repeat rules. */
function TryBox({ document }: { document: ScriptDocument }) {
  const { t } = useTranslation();
  const [sentence, setSentence] = useState('');
  const [speaker, setSpeaker] = useState<'customer' | 'agent'>('customer');
  const hits = sentence.trim() === '' ? [] : tryTriggers(document, sentence, speaker);
  return (
    <section className="tg-try" aria-labelledby="tg-try-title">
      <h3 id="tg-try-title" className="tg-subhead">
        {t('designer.triggers.tryTitle')}
      </h3>
      <div className="tg-row">
        <Input
          label={t('designer.triggers.trySentence')}
          value={sentence}
          maxLength={2_000}
          onChange={(event) => {
            setSentence(event.target.value);
          }}
        />
        <Select
          label={t('designer.triggers.trySpeaker')}
          value={speaker}
          options={(['customer', 'agent'] as const).map((value) => ({
            value,
            label: t(`designer.triggers.speakers.${value}`),
          }))}
          onValueChange={(value) => {
            setSpeaker(value === 'agent' ? 'agent' : 'customer');
          }}
        />
      </div>
      <div role="status" aria-live="polite">
        {sentence.trim() === '' ? null : hits.length === 0 ? (
          <p className="tg-hint">{t('designer.triggers.tryNone')}</p>
        ) : (
          <ul className="tg-hits">
            {hits.map((hit) => (
              <li key={hit.id}>
                {t('designer.triggers.tryHit', { trigger: hit.name, phrase: hit.phrase })}
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}
