import { LightningElement, api } from 'lwc';
import title from '@salesforce/label/c.VerbisLaunchTitle';

// Place in a Lightning page alongside an Open CTI softphone. Verbis performs redemption.
export default class VerbisLaunch extends LightningElement {
  @api agentOrigin;
  @api launchCode;
  title = title;
  get source() {
    try {
      const url = new URL(this.agentOrigin);
      if (
        url.protocol !== 'https:' ||
        url.pathname !== '/' ||
        url.search ||
        url.hash ||
        url.username ||
        url.password
      )
        return undefined;
      if (this.launchCode && !/^[A-Za-z0-9_-]{43}$/.test(this.launchCode)) return undefined;
      return `${url.origin}/launch${this.launchCode ? `#code=${this.launchCode}` : ''}`;
    } catch {
      return undefined;
    }
  }
}
