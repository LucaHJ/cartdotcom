export function floorToInterval(epochMs, intervalMs) {
  return Math.floor(epochMs / intervalMs) * intervalMs;
}

export function millisecondsUntilNextBoundary(epochMs, intervalMs) {
  return intervalMs - (epochMs % intervalMs);
}
