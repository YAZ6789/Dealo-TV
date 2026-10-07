import { describe, expect, it } from 'vitest';
import { parseVoice } from './commands';

describe('parseVoice', () => {
  it.each([
    ['Go to stats', { kind: 'navigate', path: '/stats' }],
    ['open my watchlist', { kind: 'navigate', path: '/library/plan' }],
    ['show me the airing page', { kind: 'navigate', path: '/upcoming' }],
    ['Hey Dealo, settings please', { kind: 'navigate', path: '/settings' }],
    ['next', { kind: 'step', dir: 1 }],
    ['go back', { kind: 'step', dir: -1 }],
    ['select', { kind: 'key', key: 'Enter' }],
    ['channel up', { kind: 'key', key: 'ArrowUp' }],
    ['switch to neon', { kind: 'skin', id: 'neon' }],
    ['use the light theme', { kind: 'skin', id: 'daylight' }],
    ['person of interest skin', { kind: 'skin', id: 'surveillance' }],
    ['switch to the timeline design', { kind: 'design', id: 'timeline' }],
    ['change layout to mission control', { kind: 'design', id: 'mission' }],
    ['use the swipe deck', { kind: 'design', id: 'swipe' }],
    ['add Severance to my watchlist', { kind: 'setStatus', query: 'severance', status: 'plan' }],
    ['mark Dark as watched', { kind: 'setStatus', query: 'dark', status: 'completed' }],
    ['mark Lost in Space as watched', { kind: 'setStatus', query: 'lost in space', status: 'completed' }],
    ['add Welcome to Wrexham to my watchlist', { kind: 'setStatus', query: 'welcome to wrexham', status: 'plan' }],
    ['put The Bear on hold', { kind: 'setStatus', query: 'the bear', status: 'on_hold' }],
    ["I'm watching The Bear", { kind: 'setStatus', query: 'the bear', status: 'watching' }],
    ['search for breaking bad', { kind: 'search', query: 'breaking bad' }],
    ['open succession', { kind: 'openShow', query: 'succession' }],
  ])('%s', (phrase, expected) => {
    expect(parseVoice(phrase)).toMatchObject(expected);
  });

  it('hands anything else to the assistant', () => {
    expect(parseVoice('something like Dark but funnier')).toEqual({ kind: 'ask', text: 'something like Dark but funnier' });
  });

  it('does not mistake show titles for skins without a switch verb', () => {
    expect(parseVoice('open neon genesis evangelion')).toMatchObject({ kind: 'openShow', query: 'neon genesis evangelion' });
  });
});
