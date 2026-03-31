export function sortChronologicalRows<T extends { createdAt: string; id: string }>(
  rows: T[],
): T[] {
  return [...rows].sort((left, right) => {
    const timeDelta = left.createdAt.localeCompare(right.createdAt);
    if (timeDelta !== 0) {
      return timeDelta;
    }
    return left.id.localeCompare(right.id);
  });
}
