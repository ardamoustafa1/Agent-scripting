import { describe, expect, it, vi } from 'vitest';

import {
  createAmazonConnectPort,
  createWebexDesktopPort,
  createNiceCxonePort,
  createFive9ToolkitPort,
  createFinessePort,
  createTwilioFlexPort,
  createSalesforceOpenCtiPort,
  createDynamicsCifPort,
} from './marketplace-ports.js';
import { createMarketplaceSdkBridge } from './marketplace.js';

describe('vendor SDK ports', () => {
  it('Amazon uses the initial contact id for attributes and verifies the live assigned agent', async () => {
    const api = {
      describeContact: vi.fn().mockResolvedValue({
        Contact: { InitialContactId: 'initial', AgentInfo: { Id: 'agent' } },
      }),
      getContactAttributes: vi.fn().mockResolvedValue({ Attributes: { tier: 'gold' } }),
      updateContactAttributes: vi.fn().mockResolvedValue({}),
      suspendContactRecording: vi.fn().mockResolvedValue({}),
      resumeContactRecording: vi.fn().mockResolvedValue({}),
    };
    const port = createAmazonConnectPort('instance', api);
    expect(await port.readAttributes('segment')).toEqual({ tier: 'gold' });
    await port.execute({
      platform: 'amazon-connect',
      type: 'writeAttributes',
      interactionId: 'segment',
      commandId: 'c1',
      attributes: { score: 3 },
    });
    expect(api.updateContactAttributes).toHaveBeenCalledWith({
      InstanceId: 'instance',
      InitialContactId: 'initial',
      Attributes: { score: '3' },
    });
    expect(await port.verifyParticipant('agent', 'segment')).toBe(true);
    api.describeContact.mockResolvedValue({
      Contact: {
        InitialContactId: 'initial',
        DisconnectTimestamp: '2026-10-01T10:00:00Z',
        AgentInfo: { Id: 'agent' },
      },
    });
    expect(await port.verifyParticipant('agent', 'segment')).toBe(false);
  });
  it('Finesse validates call variables and ECC names', async () => {
    const api = {
      readVariables: vi.fn(),
      updateVariables: vi.fn(),
      disposition: vi.fn(),
      verifyParticipant: vi.fn(),
    };
    const port = createFinessePort(api);
    await port.execute({
      platform: 'cisco-finesse',
      type: 'writeAttributes',
      interactionId: 'dialog',
      commandId: 'c1',
      attributes: { callVariable1: 'sale', 'user.segment': 'gold' },
    });
    expect(api.updateVariables).toHaveBeenCalledTimes(1);
    await expect(
      port.execute({
        platform: 'cisco-finesse',
        type: 'writeAttributes',
        interactionId: 'dialog',
        commandId: 'c2',
        attributes: { callVariable11: 'no' },
      }),
    ).rejects.toThrow();
  });
  it('Flex preserves task attributes while merging write-back', async () => {
    const task = {
      attributes: { queue: 'sales', nested: { keep: true } },
      setAttributes: vi.fn().mockResolvedValue(undefined),
    };
    const port = createTwilioFlexPort({
      task: () => Promise.resolve(task),
      complete: vi.fn(),
      verifyParticipant: () => Promise.resolve(true),
    });
    await port.execute({
      platform: 'twilio-flex',
      type: 'writeAttributes',
      interactionId: 'WT1',
      commandId: 'c1',
      attributes: { outcome: 'sale' },
    });
    expect(task.setAttributes).toHaveBeenCalledWith({
      queue: 'sales',
      nested: { keep: true },
      outcome: 'sale',
    });
  });
  for (const factory of [createSalesforceOpenCtiPort, createDynamicsCifPort])
    it('CRM defers ownership to CTI and refuses telephony commands', async () => {
      const verify = vi.fn().mockResolvedValue(false);
      const port = factory({
        readRecordContext: () => Promise.resolve({}),
        verifyCtiParticipant: verify,
      });
      expect(await port.verifyParticipant('agent', 'call')).toBe(false);
      expect(verify).toHaveBeenCalledWith('agent', 'call');
      await expect(
        port.execute({
          platform: 'salesforce',
          type: 'pauseRecording',
          interactionId: 'call',
          commandId: 'c1',
        }),
      ).rejects.toMatchObject({ code: 'command_not_supported' });
    });
  it('rejects commands for another platform at the bridge boundary', async () => {
    const execute = vi.fn();
    const bridge = createMarketplaceSdkBridge('five9', {
      readAttributes: () => Promise.resolve({}),
      execute,
      verifyParticipant: () => Promise.resolve(false),
    });
    await expect(
      bridge.execute({
        platform: 'amazon-connect',
        type: 'pauseRecording',
        commandId: 'c1',
        interactionId: 'call',
      }),
    ).rejects.toThrow('Wrong bridge platform');
    expect(execute).not.toHaveBeenCalled();
  });
});

for (const [platform, factory] of [
  ['cisco-webex', createWebexDesktopPort],
  ['nice-cxone', createNiceCxonePort],
  ['five9', createFive9ToolkitPort],
  ['cisco-finesse', createFinessePort],
] as const)
  it(`${platform} delegates reads, fresh participant checks and wrap-up; rejects recording controls`, async () => {
    const api = {
      readVariables: vi.fn().mockResolvedValue({ outcome: 'sale' }),
      updateVariables: vi.fn().mockResolvedValue(undefined),
      disposition: vi.fn().mockResolvedValue(undefined),
      verifyParticipant: vi.fn().mockResolvedValue(true),
    };
    const port = factory(api);
    expect(await port.readAttributes('call')).toEqual({ outcome: 'sale' });
    expect(api.readVariables).toHaveBeenCalledWith('call');
    expect(await port.verifyParticipant('agent', 'call')).toBe(true);
    expect(api.verifyParticipant).toHaveBeenCalledWith('agent', 'call');
    const base = { platform, interactionId: 'call', commandId: 'c1' };
    await port.execute({ ...base, type: 'setWrapUp', wrapUp: { code: 'DONE', subCodes: [] } });
    expect(api.disposition).toHaveBeenCalledWith('call', { code: 'DONE', subCodes: [] });
    await expect(port.execute({ ...base, type: 'setWrapUp' })).rejects.toThrow('wrapUp required');
    await expect(port.execute({ ...base, type: 'pauseRecording' })).rejects.toMatchObject({
      code: 'command_not_supported',
    });
  });
it('Finesse bounds ECC values and preserves null values', async () => {
  const updateVariables = vi.fn().mockResolvedValue(undefined);
  const port = createFinessePort({
    readVariables: vi.fn(),
    updateVariables,
    disposition: vi.fn(),
    verifyParticipant: vi.fn(),
  });
  const base = {
    platform: 'cisco-finesse' as const,
    type: 'writeAttributes' as const,
    interactionId: 'call',
    commandId: 'c1',
  };
  await port.execute({
    ...base,
    attributes: { callVariable10: null, 'user.long': 'x'.repeat(210) },
  });
  expect(updateVariables).toHaveBeenCalledOnce();
  await expect(
    port.execute({ ...base, attributes: { callVariable1: 'x'.repeat(211) } }),
  ).rejects.toThrow('Call variable exceeds');
  expect(updateVariables).toHaveBeenCalledOnce();
});
it('Flex reports unknown tasks, returns attributes and completes only with a disposition', async () => {
  const task = { attributes: { queue: 'sales' }, setAttributes: vi.fn() },
    complete = vi.fn();
  const lookup = vi.fn().mockResolvedValue(task);
  const verifyParticipant = vi.fn().mockResolvedValue(false);
  const port = createTwilioFlexPort({ task: lookup, complete, verifyParticipant });
  expect(await port.readAttributes('WT1')).toEqual({ queue: 'sales' });
  expect(await port.verifyParticipant('worker', 'WT1')).toBe(false);
  expect(verifyParticipant).toHaveBeenCalledWith('worker', 'WT1');
  const base = { platform: 'twilio-flex' as const, interactionId: 'WT1', commandId: 'c1' };
  await port.execute({ ...base, type: 'setWrapUp', wrapUp: { code: 'DONE', subCodes: [] } });
  expect(complete).toHaveBeenCalledWith('WT1', { code: 'DONE', subCodes: [] });
  await expect(port.execute({ ...base, type: 'setWrapUp' })).rejects.toMatchObject({
    code: 'command_not_supported',
  });
  await expect(port.execute({ ...base, type: 'resumeRecording' })).rejects.toMatchObject({
    code: 'command_not_supported',
  });
  lookup.mockResolvedValue(undefined);
  await expect(port.readAttributes('missing')).rejects.toMatchObject({
    code: 'interaction_unknown',
  });
});
it('Amazon handles recordings, null attribute deletion and failed ownership lookups', async () => {
  const api = {
    describeContact: vi.fn().mockResolvedValue({ Contact: { InitialContactId: 'initial' } }),
    getContactAttributes: vi.fn().mockResolvedValue({}),
    updateContactAttributes: vi.fn(),
    suspendContactRecording: vi.fn(),
    resumeContactRecording: vi.fn(),
  };
  const port = createAmazonConnectPort('instance', api);
  expect(await port.readAttributes('call')).toEqual({});
  expect(await port.verifyParticipant('agent', 'call')).toBe(false);
  const base = { platform: 'amazon-connect' as const, interactionId: 'call', commandId: 'c1' };
  await port.execute({ ...base, type: 'pauseRecording' });
  await port.execute({ ...base, type: 'resumeRecording' });
  const target = { InstanceId: 'instance', ContactId: 'call', InitialContactId: 'initial' };
  expect(api.suspendContactRecording).toHaveBeenCalledWith(target);
  expect(api.resumeContactRecording).toHaveBeenCalledWith(target);
  await port.execute({
    ...base,
    type: 'writeAttributes',
    attributes: { removed: null, flag: false },
  });
  expect(api.updateContactAttributes).toHaveBeenCalledWith({
    InstanceId: 'instance',
    InitialContactId: 'initial',
    Attributes: { removed: '', flag: 'false' },
  });
  await expect(
    port.execute({ ...base, type: 'setWrapUp', wrapUp: { code: 'DONE', subCodes: [] } }),
  ).rejects.toMatchObject({ code: 'command_not_supported' });
  api.describeContact.mockRejectedValue(new Error('synthetic lookup unavailable'));
  expect(await port.verifyParticipant('agent', 'call')).toBe(false);
});
it('marketplace bridge validates payloads before sending to an SDK and verifies the caller', async () => {
  const execute = vi.fn(),
    verifyParticipant = vi.fn().mockResolvedValue(true);
  const port = createMarketplaceSdkBridge('five9', {
    readAttributes: () => Promise.resolve({ score: 3 }),
    execute,
    verifyParticipant,
  });
  expect(await port.readAttributes('call')).toEqual({ score: 3 });
  expect(await port.verifyParticipant('agent', 'call')).toBe(true);
  const base = { platform: 'five9', commandId: 'c1', interactionId: 'call' };
  for (const type of ['writeAttributes', 'setWrapUp'])
    await expect(port.execute({ ...base, type })).rejects.toThrow();
  await port.execute({ ...base, type: 'writeAttributes', attributes: { score: 3 } });
  expect(execute).toHaveBeenCalledOnce();
});
