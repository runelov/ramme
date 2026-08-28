import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { vurderRateLimitVindu } from '../../src/lib/ratelimit.js';

const TIME_WINDOW_MS = 60 * 60 * 1000; // 1 time — samme vindu som pinforsok/regforsok bruker i drift

describe('vurderRateLimitVindu — pinforsok (maks 5/kortnavn/time)', () => {
  test('forsøk 1 til 5 tillates', () => {
    let tilstand = { antall: 0, vindusStart: 0 };
    const na = 1_000_000;
    for (let i = 1; i <= 5; i++) {
      const { tillatt, nyTilstand } = vurderRateLimitVindu(tilstand, na, 5, TIME_WINDOW_MS);
      assert.equal(tillatt, true, `forsøk ${i} skal tillates`);
      tilstand = nyTilstand;
    }
    assert.equal(tilstand.antall, 5);
  });

  test('forsøk nr. 6 (terskel+1) avvises', () => {
    let tilstand = { antall: 0, vindusStart: 0 };
    const na = 1_000_000;
    for (let i = 1; i <= 5; i++) {
      tilstand = vurderRateLimitVindu(tilstand, na, 5, TIME_WINDOW_MS).nyTilstand;
    }
    const sjette = vurderRateLimitVindu(tilstand, na + 1000, 5, TIME_WINDOW_MS);
    assert.equal(sjette.tillatt, false);
  });
});

describe('vurderRateLimitVindu — regforsok (maks 20/ip/time)', () => {
  test('forsøk 1 til 20 tillates, nr. 21 avvises', () => {
    let tilstand = { antall: 0, vindusStart: 0 };
    const na = 5_000_000;
    for (let i = 1; i <= 20; i++) {
      const res = vurderRateLimitVindu(tilstand, na, 20, TIME_WINDOW_MS);
      assert.equal(res.tillatt, true, `forsøk ${i} skal tillates`);
      tilstand = res.nyTilstand;
    }
    const nr21 = vurderRateLimitVindu(tilstand, na, 20, TIME_WINDOW_MS);
    assert.equal(nr21.tillatt, false);
  });
});

describe('vurderRateLimitVindu — vindu-reset-grensen', () => {
  test('forsøk rett FØR vinduet utløper (fortsatt innenfor) teller mot samme vindu', () => {
    const vindusStart = 0;
    const tilstand = { antall: 5, vindusStart };
    const rettFor = vindusStart + TIME_WINDOW_MS - 1;
    const res = vurderRateLimitVindu(tilstand, rettFor, 5, TIME_WINDOW_MS);
    assert.equal(res.tillatt, false); // allerede på terskelen, samme vindu
  });

  test('forsøk rett ETTER at vinduet har utløpt resetter telleren', () => {
    const vindusStart = 0;
    const tilstand = { antall: 5, vindusStart };
    const rettEtter = vindusStart + TIME_WINDOW_MS; // >= vindusMs => nytt vindu
    const res = vurderRateLimitVindu(tilstand, rettEtter, 5, TIME_WINDOW_MS);
    assert.equal(res.tillatt, true);
    assert.equal(res.nyTilstand.antall, 1);
    assert.equal(res.nyTilstand.vindusStart, rettEtter);
  });
});

describe('vurderRateLimitVindu — isolasjon mellom nøkler', () => {
  test('to uavhengige tilstander (ett per kortnavn/IP) påvirker ikke hverandre', () => {
    let tilstandA = { antall: 0, vindusStart: 0 };
    let tilstandB = { antall: 0, vindusStart: 0 };
    const na = 10_000;

    for (let i = 0; i < 5; i++) {
      tilstandA = vurderRateLimitVindu(tilstandA, na, 5, TIME_WINDOW_MS).nyTilstand;
    }
    // A er nå på terskelen (5/5) — B er fortsatt helt fersk og skal tillates
    // uavhengig av A sin tilstand (funksjonen tar tilstanden som eksplisitt
    // parameter, ingen delt/global state).
    const resB = vurderRateLimitVindu(tilstandB, na, 5, TIME_WINDOW_MS);
    assert.equal(resB.tillatt, true);
    assert.equal(resB.nyTilstand.antall, 1);

    const resA = vurderRateLimitVindu(tilstandA, na, 5, TIME_WINDOW_MS);
    assert.equal(resA.tillatt, false);
  });
});

describe('vurderRateLimitVindu — tom/manglende tilstand (første forsøk noensinne)', () => {
  test('null-tilstand behandles som et ferskt vindu', () => {
    const res = vurderRateLimitVindu(null, 42, 5, TIME_WINDOW_MS);
    assert.equal(res.tillatt, true);
    assert.equal(res.nyTilstand.antall, 1);
  });
});
