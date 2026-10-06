import 'amazon-connect-streams';

/** Browser hint source only. acceptHint must use the authenticated BFF and server enrichment. */
export function mountAmazonCcp({ connect, container, ccpUrl, acceptHint }) {
  const url = new URL(ccpUrl);
  if (url.protocol !== 'https:' || url.username || url.password)
    throw new Error('HTTPS CCP required');
  connect.core.initCCP(container, {
    ccpUrl: url.href,
    loginPopup: true,
    loginPopupAutoClose: true,
  });
  let stopped = false;
  let pending = Promise.resolve();
  connect.contact((contact) => {
    const send = (state) => {
      if (stopped) return;
      const attributes = Object.fromEntries(
        Object.entries(contact.getAttributes()).map(([key, value]) => [key, value.value]),
      );
      const hint = {
        contactId: contact.getContactId(),
        channel: contact.getType(),
        state,
        attributes,
      };
      // acceptHint must durably queue/retry; flush exposes an unacknowledged hint.
      pending = pending.then(() => acceptHint(hint));
    };
    contact.onIncoming(() => send('interactionOffered'));
    contact.onConnected(() => send('connected'));
    contact.onACW(() => send('wrapupRequired'));
    contact.onEnded(() => send('ended'));
  });
  return {
    flush: () => pending,
    dispose: () => {
      stopped = true;
      connect.core.terminate();
    },
  };
}
