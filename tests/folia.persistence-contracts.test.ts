import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { deriveAndroidDevice } from '../src/serverless/derivedDevice';
import { createSealedSessionResolver } from '../src/serverless/sealedResolver';
import {
  createDeviceContextStore,
  createFileDeviceContextRepository,
} from '../src/services/auth/deviceContext';
import {
  type AuthSession,
  createMemoryAuthSessionRepository,
  createStoredSessionResolver,
} from '../src/services/auth/qrLogin';
import deviceFixture from './fixtures/contracts/device-v1.json';
import { CONTRACT_CREDENTIAL, CONTRACT_NOW, CONTRACT_SECRET } from './helpers/contractUpstream';

// A serialized Electron repository record, with synthetic identity and credentials only.
const savedSession: AuthSession = {
  token: 'a'.repeat(64),
  credential: {
    ...CONTRACT_CREDENTIAL,
    refresh_token: 'fixture-refresh-token',
    refresh_key: 'fixture-refresh-key',
  },
  device: deviceFixture.device,
  expiresAt: CONTRACT_NOW + 3600000,
};

describe('Folia persisted session contracts', () => {
  it('opens an existing version-one sealed token without reissuing it', async () => {
    const token = fs
      .readFileSync(path.join(__dirname, 'fixtures/contracts/sealed-auth-v1.txt'), 'utf8')
      .trim();
    const resolver = createSealedSessionResolver({
      secrets: { current: CONTRACT_SECRET },
      now: () => CONTRACT_NOW,
    });
    expect(await resolver.resolve(token)).toMatchObject({
      token,
      credential: CONTRACT_CREDENTIAL,
      expiresAt: CONTRACT_NOW + 3600000,
    });
    const rotated = createSealedSessionResolver({
      secrets: { current: 'rotated-contract-secret', previous: CONTRACT_SECRET },
      now: () => CONTRACT_NOW,
    });
    expect((await rotated.resolve(token))?.credential).toEqual(CONTRACT_CREDENTIAL);
    const expired = createSealedSessionResolver({
      secrets: { current: CONTRACT_SECRET },
      now: () => CONTRACT_NOW + 3600000,
    });
    expect(await expired.resolve(token)).toBeNull();
  });
  it('restores the complete AuthSession array without issuing a new device or token', async () => {
    const persisted = JSON.parse(JSON.stringify([savedSession]));
    const save = jest.fn();
    const resolver = createStoredSessionResolver({
      repository: { kind: 'electron-fixture', load: () => persisted, save },
      now: () => CONTRACT_NOW,
      randomBytes: (size) => Buffer.alloc(size, 1),
    });
    expect(await resolver.resolve(savedSession.token)).toEqual(savedSession);
    expect(save).not.toHaveBeenCalled();
  });

  it('restores sessions through the synchronous repository injection hook', async () => {
    const resolver = createStoredSessionResolver({
      repository: createMemoryAuthSessionRepository(),
      now: () => CONTRACT_NOW,
      randomBytes: (size) => Buffer.alloc(size, 1),
    });
    const result = resolver.useRepository?.({
      kind: 'electron-fixture',
      load: () => [savedSession],
      save: jest.fn(),
    });
    expect(result).toBeUndefined();
    expect(await resolver.resolve(savedSession.token)).toEqual(savedSession);
  });

  it.each([
    { ...savedSession, expiresAt: CONTRACT_NOW },
    { ...savedSession, credential: { ...CONTRACT_CREDENTIAL, musickey: '' } },
    { ...savedSession, device: { model: 'broken-fixture' } },
    { ...savedSession, token: '' },
  ])('rejects an unusable stored record without losing a valid sibling', async (invalid) => {
    const valid = { ...savedSession, token: 'b'.repeat(64) };
    const resolver = createStoredSessionResolver({
      repository: { kind: 'electron-fixture', load: () => [invalid, valid], save: jest.fn() },
      now: () => CONTRACT_NOW,
      randomBytes: (size) => Buffer.alloc(size, 1),
    });
    expect(await resolver.resolve(valid.token)).toEqual(valid);
    resolver.cleanup?.();
    expect(await resolver.resolve(savedSession.token)).toBeNull();
  });

  it('pins the existing derived device identity for a deployment secret', async () => {
    const {
      qimei: _qimei,
      qimei36: _qimei36,
      qimeiSavedAt: _savedAt,
      sessionUid: _uid,
      sessionSid: _sid,
      sessionVkey: _vkey,
      ...base
    } = deviceFixture.device;
    expect(await deriveAndroidDevice(CONTRACT_SECRET)).toEqual(base);
    expect(await deriveAndroidDevice(CONTRACT_SECRET)).toEqual(base);
    expect(await deriveAndroidDevice('another-contract-secret')).not.toEqual(base);
  });

  it('reads and writes the device file without changing its envelope or stored identity', () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'qq-contract-device-'));
    try {
      const filename = path.join(directory, 'qq-device.json');
      fs.copyFileSync(path.join(__dirname, 'fixtures/contracts/device-v1.json'), filename);
      const original = fs.readFileSync(filename, 'utf8');
      const repository = createFileDeviceContextRepository(filename);
      const context = createDeviceContextStore(repository);
      expect(context.get()).toEqual(deviceFixture.device);
      expect(fs.readFileSync(filename, 'utf8')).toBe(original);
      context.persist();
      expect(JSON.parse(fs.readFileSync(filename, 'utf8'))).toEqual(deviceFixture);
      expect(createDeviceContextStore(createFileDeviceContextRepository(filename)).get()).toEqual(
        deviceFixture.device,
      );
    } finally {
      fs.rmSync(directory, { recursive: true, force: true });
    }
  });

  it('keeps sealed credential fields and drops long-lived refresh secrets', async () => {
    const resolver = createSealedSessionResolver({
      secrets: { current: CONTRACT_SECRET },
      now: () => CONTRACT_NOW,
    });
    const token = await resolver.issue(savedSession);
    expect(token).toMatch(/^qq1\.a\./);
    expect(token).not.toContain(CONTRACT_CREDENTIAL.musickey);
    const restored = await resolver.resolve(token);
    expect(restored?.credential).toEqual(CONTRACT_CREDENTIAL);
    expect(restored?.expiresAt).toBe(savedSession.expiresAt);
    expect(restored?.device).toEqual(await deriveAndroidDevice(CONTRACT_SECRET));
  });
});
