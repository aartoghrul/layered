const EVENT = "layered:focus-card";

export interface CardFocusRequest {
  childId: string;
  focusEditor: boolean;
}

/** Ask the depth card for `childId` to scroll into view (and optionally take focus). */
export function requestCardFocus(childId: string, focusEditor: boolean) {
  // Let the new mark reach the store and the card mount first.
  setTimeout(() => {
    window.dispatchEvent(new CustomEvent<CardFocusRequest>(EVENT, { detail: { childId, focusEditor } }));
  }, 30);
}

export function onCardFocusRequest(fn: (req: CardFocusRequest) => void) {
  const handler = (e: Event) => fn((e as CustomEvent<CardFocusRequest>).detail);
  window.addEventListener(EVENT, handler);
  return () => window.removeEventListener(EVENT, handler);
}
