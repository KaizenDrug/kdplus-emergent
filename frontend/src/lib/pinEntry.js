// Shared by physical keyboard and on-screen keypad.
export const isCompletePin = (pin) => /^\d{4}$/.test(pin);

export function appendPinDigit(pin, digit) {
  if (!/^\d$/.test(digit) || pin.length >= 4) return pin;
  return pin + digit;
}

export function deletePinDigit(pin) {
  return pin.slice(0, -1);
}
