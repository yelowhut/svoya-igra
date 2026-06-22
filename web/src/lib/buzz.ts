export function reactionMs(goReceivedAt: number, pressedAt: number): number {
  return pressedAt - goReceivedAt;
}
