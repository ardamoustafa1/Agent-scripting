import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { z } from 'zod';

import { ThreadSchema } from '@verbis/shared-types';
import { Button, Badge, Textarea, MultiSelect, Alert } from '@verbis/ui';

import { request } from '../api/client.js';
import { useWorkspace } from '../workspace/context.js';

export function Comments({
  scriptId,
  number,
  nodeId,
  focusedThreadId = '',
}: {
  scriptId: string;
  number: number;
  nodeId: string;
  focusedThreadId?: string;
}) {
  const { t } = useTranslation(),
    { session } = useWorkspace(),
    client = useQueryClient();
  const [text, setText] = useState(''),
    [mentions, setMentions] = useState<string[]>([]),
    [reply, setReply] = useState<string | null>(null),
    [busy, setBusy] = useState(false),
    [failed, setFailed] = useState(false);
  const path = `/v1/scripts/${scriptId}/versions/${number}/comments`,
    key = [
      'workspace',
      session.user.tenantId,
      session.user.id,
      session.session.id,
      'comments',
      scriptId,
      number,
    ];
  const query = useQuery({
    queryKey: key,
    queryFn: ({ signal }) => request(path, z.array(ThreadSchema), { signal }),
    refetchInterval: 15000,
  });
  const perform = async (suffix: string, body: unknown) => {
    setBusy(true);
    setFailed(false);
    try {
      await request(`${path}${suffix}`, ThreadSchema, {
        method: 'POST',
        csrf: session.csrfToken,
        body,
      });
      setText('');
      setMentions([]);
      setReply(null);
      await client.invalidateQueries({ queryKey: key });
    } catch {
      setFailed(true);
    } finally {
      setBusy(false);
    }
  };
  const members = useQuery({
    queryKey: [...key, 'members'],
    queryFn: ({ signal }) =>
      request(
        `/v1/scripts/${scriptId}/versions/${number}/team-members`,
        z.array(z.object({ id: z.uuid(), name: z.string() })),
        { signal },
      ),
  });
  const activeNode = query.data?.find((thread) => thread.id === focusedThreadId)?.nodeId ?? nodeId;
  const ids = mentions;
  const valid = z.array(z.uuid()).max(20).safeParse(ids).success;
  return (
    <section className="lc-card" aria-label={t('designer.lifecycle.comments')}>
      <h2>
        {t('designer.lifecycle.comments')} <code>{activeNode}</code>
      </h2>
      {(failed || query.isError) && <Alert tone="danger" title={t('designer.lifecycle.failed')} />}
      <ul className="lc-threads">
        {query.data
          // The script-wide view also gathers agent feedback, which is filed on page roots.
          ?.filter(
            (thread) =>
              thread.nodeId === activeNode ||
              (activeNode === 'script' && thread.messages[0]?.feedback !== undefined),
          )
          .map((thread) => (
            <li key={thread.id}>
              <Badge tone={thread.resolved ? 'success' : 'info'}>
                {t(thread.resolved ? 'designer.lifecycle.resolved' : 'designer.lifecycle.open')}
              </Badge>
              <ol>
                {thread.messages.map((m) => (
                  <li key={m.id}>
                    <strong>
                      {members.data?.find((u) => `user:${u.id}` === m.author)?.name ?? m.author}
                    </strong>
                    {m.feedback ? (
                      <p className="lc-agent-feedback">
                        <Badge tone="warning">{t('designer.comments.agentFeedback')}</Badge>{' '}
                        {t(`designer.comments.feedbackReasons.${m.feedback.reason}`)}
                      </p>
                    ) : (
                      <p>{m.text}</p>
                    )}
                    {m.mentions.length > 0 && (
                      <p>
                        {m.mentions
                          .map((id) => `@${members.data?.find((u) => u.id === id)?.name ?? id}`)
                          .join(' ')}
                      </p>
                    )}
                    <time>{m.createdAt}</time>
                  </li>
                ))}
              </ol>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => {
                  setReply(thread.id);
                }}
              >
                {t('designer.lifecycle.reply')}
              </Button>
              <Button
                size="sm"
                variant="ghost"
                loading={busy}
                onClick={() =>
                  void perform(`/${thread.id}/resolve`, {
                    version: thread.version,
                    resolved: !thread.resolved,
                  })
                }
              >
                {t(thread.resolved ? 'designer.lifecycle.reopen' : 'designer.lifecycle.resolve')}
              </Button>
            </li>
          ))}
      </ul>
      {reply && (
        <p role="status">
          {t('designer.lifecycle.reply')}{' '}
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              setReply(null);
            }}
          >
            {t('designer.lifecycle.cancel')}
          </Button>
        </p>
      )}
      <Textarea
        label={t('designer.lifecycle.comment')}
        value={text}
        maxLength={4000}
        onChange={(e) => {
          setText(e.target.value);
        }}
      />
      <MultiSelect
        label={t('designer.lifecycle.mentions')}
        value={mentions}
        onValueChange={setMentions}
        options={(members.data ?? []).map((user) => ({ value: user.id, label: user.name }))}
      />
      <Button
        loading={busy}
        disabled={!text.trim() || !valid}
        onClick={() =>
          void perform(reply ? `/${reply}/replies` : '', {
            text,
            mentions: ids,
            ...(reply ? {} : { nodeId: activeNode }),
          })
        }
      >
        {t('designer.lifecycle.sendComment')}
      </Button>
    </section>
  );
}
