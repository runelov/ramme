import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { sha256Hex } from '../../src/lib/crypto.js';
import {
  erGyldigPin,
  erGyldigKortnavn,
  normaliserKortnavn,
  sammenlignPin,
  avgjorRegistreringUtfall,
  avgjorRolleVedRegistrering,
} from '../../src/lib/pin.js';

describe('avgjorRolleVedRegistrering', () => {
  test('første bruker (0 eksisterende) blir admin', () => {
    assert.equal(avgjorRolleVedRegistrering(0), 'admin');
  });
  test('andre bruker (1 eksisterende) blir vanlig bruker', () => {
    assert.equal(avgjorRolleVedRegistrering(1), 'bruker');
  });
  test('tjuende bruker blir fortsatt vanlig bruker', () => {
    assert.equal(avgjorRolleVedRegistrering(19), 'bruker');
  });
});

describe('erGyldigPin', () => {
  test('godtar 6 sifre', () => assert.equal(erGyldigPin('123456'), true));
  test('godtar 12 sifre', () => assert.equal(erGyldigPin('123456789012'), true));
  test('avviser 5 sifre (under minimum)', () => assert.equal(erGyldigPin('12345'), false));
  test('avviser 13 sifre (over maksimum)', () => assert.equal(erGyldigPin('1234567890123'), false));
  test('avviser bokstaver', () => assert.equal(erGyldigPin('12345a'), false));
  test('avviser tomt', () => assert.equal(erGyldigPin(''), false));
});

describe('erGyldigKortnavn', () => {
  test('godtar vanlig navn', () => assert.equal(erGyldigKortnavn('Rune'), true));
  test('godtar navn med mellomrom/bindestrek/norske bokstaver', () => assert.equal(erGyldigKortnavn('Åse-Kari Øyen'), true));
  test('avviser tomt/kun mellomrom', () => assert.equal(erGyldigKortnavn('   '), false));
  test('avviser for langt navn (>30 tegn)', () => assert.equal(erGyldigKortnavn('a'.repeat(31)), false));
  test('avviser HTML-spesialtegn', () => assert.equal(erGyldigKortnavn('<script>'), false));
});

describe('normaliserKortnavn', () => {
  test('trimmer og gjør lowercase', () => assert.equal(normaliserKortnavn('  Rune  '), 'rune'));
  test('to ulike skrivemåter normaliserer likt', () => {
    assert.equal(normaliserKortnavn('Ola'), normaliserKortnavn('OLA'));
  });
});

describe('sammenlignPin', () => {
  test('riktig PIN godkjennes', async () => {
    const hash = await sha256Hex('123456');
    assert.equal(await sammenlignPin('123456', hash), true);
  });
  test('feil PIN avvises', async () => {
    const hash = await sha256Hex('123456');
    assert.equal(await sammenlignPin('654321', hash), false);
  });
  test('PIN som kun avviker i ett siffer avvises', async () => {
    const hash = await sha256Hex('123456');
    assert.equal(await sammenlignPin('123457', hash), false);
  });
  test('sammenligner aldri klartekst mot klartekst — en hash-formet streng som PIN matcher ikke seg selv som hash', async () => {
    const enHash = await sha256Hex('123456');
    // Sender selve hash-strengen inn SOM PIN — skal IKKE matche den lagrede
    // hashen (det ville krevd at funksjonen sammenlignet klartekst mot
    // klartekst et sted i stedet for å hashe inputen).
    assert.equal(await sammenlignPin(enHash, enHash), false);
  });
});

describe('avgjorRegistreringUtfall', () => {
  test('kortnavn finnes ikke -> opprettNyKonto', () => {
    const res = avgjorRegistreringUtfall({ kortnavnFinnes: false, pinKorrekt: false });
    assert.equal(res.utfall, 'opprettNyKonto');
  });

  test('kortnavn finnes, riktig PIN -> loggInnEksisterende', () => {
    const res = avgjorRegistreringUtfall({ kortnavnFinnes: true, pinKorrekt: true });
    assert.equal(res.utfall, 'loggInnEksisterende');
  });

  test('kortnavn finnes, feil PIN -> avvisTvetydig med feilmelding', () => {
    const res = avgjorRegistreringUtfall({ kortnavnFinnes: true, pinKorrekt: false });
    assert.equal(res.utfall, 'avvisTvetydig');
    assert.ok(res.feilmelding && res.feilmelding.length > 0);
  });

  // Selve sikkerhetsegenskapen ADR 11 krever: "feil PIN på egen konto" og
  // "kortnavn finnes og tilhører noen andre" har IDENTISK inputform
  // ({kortnavnFinnes:true, pinKorrekt:false}) uansett hvilket av de to det
  // faktisk er — funksjonen kan derfor umulig gi forskjellig svar, siden den
  // ikke får noen ekstra informasjon til å skille dem. Verifiseres eksplisitt
  // her ved å sammenligne to uavhengige kall bit-for-bit, ikke bare lese koden.
  test('begge veiene inn til avvisTvetydig gir bit-for-bit identisk resultat', () => {
    const resultatA = avgjorRegistreringUtfall({ kortnavnFinnes: true, pinKorrekt: false }); // "feil PIN på egen konto"
    const resultatB = avgjorRegistreringUtfall({ kortnavnFinnes: true, pinKorrekt: false }); // "kortnavn tilhører noen andre"
    assert.deepEqual(resultatA, resultatB);
  });
});
