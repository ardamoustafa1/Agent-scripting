// Verbis custom widget for Avaya Experience Platform Workspaces (Widget Framework).
// Frames agent-web's embedded launch for the interaction the widget is placed on. The interaction
// id is only a hint: Verbis re-verifies it with the AXP Engagement API (ADR-0017 b, ADR-0020).
// No script/campaign/user ids are ever put in the URL; only connector + interaction, in the fragment.
(function () {
  'use strict';

  var UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  var INTERACTION = /^[A-Za-z0-9._:-]{1,128}$/;
  // iframe accessible name only; the content itself is localized by agent-web.
  var TITLES = { tr: 'Verbis etkileşim scripti', en: 'Verbis interaction script' };

  function config(element) {
    var origin = element.getAttribute('agent-web-origin') || '';
    var connector = element.getAttribute('connector-id') || '';
    var url;
    try {
      url = new URL(origin);
    } catch (e) {
      return null;
    }
    if (url.protocol !== 'https:' || url.pathname !== '/' || !UUID.test(connector)) return null;
    return { origin: url.origin, connector: connector };
  }

  class VerbisScriptWidget extends HTMLElement {
    connectedCallback() {
      var cfg = config(this);
      if (cfg === null) return;
      var interactionId = this.getAttribute('interactionid');
      var api =
        window.WS && typeof window.WS.widgetAPI === 'function'
          ? window.WS.widgetAPI(interactionId)
          : null;
      var lang = (document.documentElement.lang || 'en').slice(0, 2);
      var frame = document.createElement('iframe');
      frame.title = TITLES[lang] || TITLES.en;
      frame.setAttribute(
        'sandbox',
        'allow-scripts allow-same-origin allow-forms allow-popups allow-popups-to-escape-sandbox',
      );
      frame.setAttribute('referrerpolicy', 'no-referrer');
      frame.style.cssText = 'width:100%;height:100%;border:0;';
      this.appendChild(frame);
      var current = null;
      var open = function (id) {
        if (typeof id !== 'string' || !INTERACTION.test(id) || id === current) return;
        current = id;
        frame.src =
          cfg.origin +
          '/launch#connector=' +
          encodeURIComponent(cfg.connector) +
          '&conversation=' +
          encodeURIComponent(id);
      };
      if (interactionId) open(interactionId);
      if (api && typeof api.onDataEvent === 'function')
        api.onDataEvent('onInteractionEvent', function (data) {
          if (data && data.id) open(String(data.id));
        });
    }
  }

  if (!customElements.get('verbis-script-widget'))
    customElements.define('verbis-script-widget', VerbisScriptWidget);
})();
