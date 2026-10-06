import { expect, it } from 'vitest';

import { RecordingGuard, RecordingGuardError, type RecorderPort } from './recording-guard.js';

function fake(options: { pauseFails?: boolean; resumeFails?: boolean } = {}) {
  const log: string[] = [];
  const port: RecorderPort = {
    pause: () => {
      log.push('pause');
      return options.pauseFails ? Promise.reject(new Error('no ack')) : Promise.resolve();
    },
    resume: () => {
      log.push('resume');
      return options.resumeFails ? Promise.reject(new Error('no ack')) : Promise.resolve();
    },
  };
  return { log, port };
}
it('captures strictly between the pause ACK and the resume ACK', async () => {
  const { log, port } = fake();
  const guard = new RecordingGuard(port);
  await guard.withPausedRecording(() => {
    log.push('capture');
    expect(guard.state).toBe('capturing');
    return Promise.resolve();
  });
  expect(log).toEqual(['pause', 'capture', 'resume']);
  expect(guard.state).toBe('recording');
});
it('never captures without a pause ACK and fails closed', async () => {
  const { log, port } = fake({ pauseFails: true });
  const guard = new RecordingGuard(port);
  await expect(
    guard.withPausedRecording(() => {
      log.push('capture');
      return Promise.resolve();
    }),
  ).rejects.toMatchObject({ code: 'VERBIS_RECORDING_NOT_PAUSED' });
  expect(log).toEqual(['pause']);
  expect(guard.state).toBe('failed');
  await expect(guard.withPausedRecording(() => Promise.resolve())).rejects.toBeInstanceOf(
    RecordingGuardError,
  );
});
it('resumes even when capture throws, and flags a missing resume ACK', async () => {
  const a = fake();
  const guard = new RecordingGuard(a.port);
  await expect(guard.withPausedRecording(() => Promise.reject(new Error('psp')))).rejects.toThrow(
    'psp',
  );
  expect(a.log).toEqual(['pause', 'resume']);
  expect(guard.state).toBe('recording');
  const b = fake({ resumeFails: true });
  const stuck = new RecordingGuard(b.port);
  await expect(stuck.withPausedRecording(() => Promise.resolve())).rejects.toMatchObject({
    code: 'VERBIS_RECORDING_RESUME_FAILED',
  });
  expect(stuck.state).toBe('failed');
});

it('times out a non-cooperating recorder without ever capturing', async () => {
  let captured = false;
  const guard = new RecordingGuard(
    {
      pause: () =>
        new Promise(() => {
          /* deliberately ignores abort; the deadline must bound it */
        }),
      resume: () => Promise.resolve(),
    },
    5,
  );
  await expect(
    guard.withPausedRecording(() => {
      captured = true;
      return Promise.resolve();
    }),
  ).rejects.toMatchObject({ code: 'VERBIS_RECORDING_NOT_PAUSED' });
  expect(captured).toBe(false);
});
