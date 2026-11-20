// F9 is reserved for opening checkout, not for completing a sale.
// Do not consume the key when another popup or a blocking operation is active.
export function shouldOpenChargeShortcut(event, { canCharge = false, blocked = false } = {}) {
  return event?.key === "F9" &&
    !event.defaultPrevented && !event.repeat && !event.isComposing &&
    !event.altKey && !event.ctrlKey && !event.metaKey &&
    canCharge && !blocked;
}
