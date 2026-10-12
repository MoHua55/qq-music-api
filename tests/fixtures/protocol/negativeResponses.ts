// Only observed numeric facts are retained. All identifiers, names and paths are synthetic.
// GetEVkey observations do not establish the meaning of UrlGetVkey result/subcode values.
const entry = (songmid: string, result: number, purl: string) => ({
  songmid,
  result,
  subcode: 0,
  errtype: '',
  purl,
});
const envelope = (midurlinfo: ReturnType<typeof entry>[]) => ({
  code: 0,
  req_0: { code: 0, data: { retcode: 0, sip: ['https://stream.invalid/'], midurlinfo } },
});

export const PLAYBACK_OBSERVATIONS = [
  { name: 'EVKEY-SUCCESS', response: envelope([entry('fixture-playable', 0, 'fixture.m4a')]) },
  { name: 'EVKEY-104003', response: envelope([entry('fixture-denied', 104003, '')]) },
  {
    name: 'EVKEY-PARTIAL',
    response: envelope([
      entry('fixture-playable', 0, 'fixture.m4a'),
      entry('fixture-denied', 104003, ''),
    ]),
  },
  {
    name: 'PAY-PLAYABLE',
    song: {
      mid: 'fixture-paid',
      title: 'Fixture paid song',
      pay: {
        pay_month: 1,
        pay_play: 1,
        pay_down: 1,
        pay_status: 1,
        price_track: 200,
        time_free: 0,
      },
      file: { size_try: 1000 },
    },
    response: envelope([entry('fixture-paid', 0, 'fixture.m4a')]),
  },
  {
    name: 'PAY-UNKNOWN',
    song: {
      mid: 'fixture-unpaid',
      title: 'Fixture unpaid song',
      pay: { pay_play: 0, pay_status: 0, pay_down: 1 },
      file: { size_try: 1000 },
    },
    response: envelope([entry('fixture-unpaid', 104003, '')]),
  },
  { name: 'UNKNOWN-CODE', response: envelope([entry('fixture-unknown', 987654, '')]) },
];

export const VIP_OBSERVATIONS = [
  {
    name: 'VIP-FREE',
    response: {
      code: 0,
      req_0: {
        code: 0,
        data: { infoMap: { '10000': { iVipFlag: 0, iSuperVip: 0, iNewSuperVip: 0 } } },
      },
    },
  },
  {
    name: 'VIP-GREEN',
    response: {
      code: 0,
      req_0: {
        code: 0,
        data: { infoMap: { '10000': { iVipFlag: 1, iSuperVip: 1, iNewSuperVip: 1 } } },
      },
    },
  },
];

export const PLAYLIST_WRITE_OBSERVATION = {
  code: 0,
  req_0: { code: 2001, data: { retCode: 0 } },
};

export const AUTH_ISOLATION_CODES = [1000, 104400, 104401, 20279, 20450];
