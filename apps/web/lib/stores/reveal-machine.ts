export type RevealStage = 'sealed' | 'opening' | 'reveal' | 'summary';

export interface RevealState {
  stage: RevealStage;
  /** Cards in the opened pack; the cards themselves stay in the mutation's result. */
  total: number;
  /** The card being shown during `reveal`. */
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

// sealed → opening → reveal → summary → sealed. An event the current stage
// does not accept returns the state unchanged, so no sequence of events can
// reach a stage out of order or an index outside the pack.
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
