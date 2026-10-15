import { QqApiError } from '../src/protocol/errors';
import { albumOwnerOf } from '../src/services/user/albumOwner';

describe('album owner precision', () => {
  it.each([
    [{ str_musicid: '10000' }, { uin: '10000', statusUin: 10000 }],
    [{ str_musicid: '9007199254740991' }, { uin: '9007199254740991', statusUin: 9007199254740991 }],
    [
      { str_musicid: '9007199254740992' },
      { uin: '9007199254740992', statusUin: '9007199254740992' },
    ],
    [
      { str_musicid: '1234567890123456789', musicid: 1234567890123456800 },
      { uin: '1234567890123456789', statusUin: '1234567890123456789' },
    ],
    [
      { str_musicid: '', musicid: 10000 },
      { uin: '10000', statusUin: 10000 },
    ],
    [
      { str_musicid: '0', musicid: '10000' },
      { uin: '10000', statusUin: 10000 },
    ],
    [{ str_musicid: ' 0010000 ' }, { uin: '0010000', statusUin: 10000 }],
  ])('preserves the chosen exact owner: %j', (credential, expected) => {
    expect(albumOwnerOf(credential)).toEqual(expected);
  });
  it.each([
    {},
    { musicid: 1234567890123456800 },
    { musicid: 1.5 },
    { musicid: -1 },
    { str_musicid: '0' },
    { str_musicid: '000' },
    { str_musicid: '1e18' },
    { str_musicid: '-1' },
    { str_musicid: '1'.repeat(20) },
    { musicid: null },
    { musicid: true },
    { str_musicid: 'bad', musicid: 10000 },
  ])('rejects an owner that cannot be represented exactly: %j', (credential) => {
    expect(() => albumOwnerOf(credential)).toThrow(QqApiError);
  });
});
