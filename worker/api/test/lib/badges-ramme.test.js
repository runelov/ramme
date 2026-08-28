import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { beregnRammevandrerNiva, erHeleGjengenOppnadd } from '../../src/lib/badges-ramme.js';

const TRE_SONER = [
  { id: 'tunet', navn: 'Tunet' },
  { id: 'havlystparken', navn: 'Havlystparken' },
  { id: 'strandsonen', navn: 'Strandsonen' },
];

describe('beregnRammevandrerNiva', () => {
  test('0 soner besøkt -> ingen badge oppnådd', () => {
    const res = beregnRammevandrerNiva(new Set(), TRE_SONER);
    assert.equal(res.badges[0].opptjent, false);
    assert.equal(res.badges[1].opptjent, false);
  });

  test('delvis dekning (2 av 3) -> riktig mellomtrinn oppnådd, toppnivå ikke', () => {
    const res = beregnRammevandrerNiva(new Set(['tunet', 'strandsonen']), TRE_SONER);
    assert.equal(res.badges[0].opptjent, true); // trinn 1: ceil(3/2)=2
    assert.equal(res.badges[1].opptjent, false); // trinn 2: alle 3
  });

  test('alle soner besøkt -> toppnivå oppnådd', () => {
    const res = beregnRammevandrerNiva(new Set(['tunet', 'havlystparken', 'strandsonen']), TRE_SONER);
    assert.equal(res.badges[0].opptjent, true);
    assert.equal(res.badges[1].opptjent, true);
    assert.equal(res.antallBesokt, 3);
    assert.equal(res.totalt, 3);
  });

  test('en utdatert sone-ID (finnes ikke i sonelisten lenger) teller ikke med, og krasjer ikke', () => {
    const res = beregnRammevandrerNiva(new Set(['tunet', 'en-sone-som-ble-fjernet']), TRE_SONER);
    assert.equal(res.antallBesokt, 1); // kun 'tunet' telles
    assert.equal(res.badges[0].opptjent, false); // 1 < ceil(3/2)=2
  });

  test('0 soner definert i det hele tatt -> ingen badge (unngår 0-av-0-alltid-sann)', () => {
    const res = beregnRammevandrerNiva(new Set(), []);
    assert.equal(res.totalt, 0);
    assert.equal(res.badges[0].opptjent, false);
    assert.equal(res.badges[1].opptjent, false);
  });
});

describe('erHeleGjengenOppnadd', () => {
  test('0 aktive brukere -> ikke oppnådd (unngår divisjon-ved-null/alltid-sann)', () => {
    assert.equal(erHeleGjengenOppnadd(0, 0), false);
  });

  test('delvis oppmøte -> ikke oppnådd', () => {
    assert.equal(erHeleGjengenOppnadd(3, 5), false);
  });

  test('full oppmøte -> oppnådd', () => {
    assert.equal(erHeleGjengenOppnadd(5, 5), true);
  });

  test('flere med funn enn aktive brukere (bør ikke skje, men skal ikke krasje) -> oppnådd', () => {
    assert.equal(erHeleGjengenOppnadd(6, 5), true);
  });
});
