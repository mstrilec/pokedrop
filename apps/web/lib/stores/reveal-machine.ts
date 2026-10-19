export type RevealStage = 'sealed' | 'opening' | 'reveal' | 'summary';

export interface RevealState {
  stage: RevealStage;
  total: number;
  index: number;
  skipped: boolean;
}

export type RevealEvent =
  | { type: 'open' }
  | { type: 'opened'; total: number }
  | { type: 'failed' }
  | { type: 'next' }
  | { type: 'skip' }
  | { type: 'reset' };

export const SEALED: RevealState = { stage: 'sealed', total: 0, index: 0, skipped: false };

export function transition(state: RevealState, event: RevealEvent): RevealState {
  switch (state.stage) {
    case 'sealed':
      return event.type === 'open' ? { ...SEALED, stage: 'opening' } : state;
    case 'opening':
      if (event.type === 'opened' && Number.isInteger(event.total) && event.total > 0) {
        return { ...SEALED, stage: 'reveal', total: event.total };
      }
      return event.type === 'failed' ? SEALED : state;
    case 'reveal':
      if (event.type === 'next') {
        return state.index + 1 < state.total
          ? { ...state, index: state.index + 1 }
          : { ...state, stage: 'summary' };
      }
      return event.type === 'skip' ? { ...state, stage: 'summary', skipped: true } : state;
    case 'summary':
      return event.type === 'reset' ? SEALED : state;
  }
}
