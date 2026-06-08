export function estimateLines(text: string, charsPerLine: number) {
  if (!text) return 0;
  return Math.max(1, Math.ceil(text.length / charsPerLine));
}

export function paginateByHeight<T>(
  items: T[],
  heightFor: (item: T) => number,
  maxHeight: number,
) {
  const pages: T[][] = [];
  let current: T[] = [];
  let used = 0;

  items.forEach((item) => {
    const height = heightFor(item);
    if (current.length > 0 && used + height > maxHeight) {
      pages.push(current);
      current = [];
      used = 0;
    }
    current.push(item);
    used += height;
  });

  if (current.length > 0) pages.push(current);
  return pages;
}

export function paginateByHeightWithInitial<T>(
  items: T[],
  heightFor: (item: T) => number,
  firstMax: number,
  nextMax: number,
) {
  const pages: T[][] = [];
  let current: T[] = [];
  let used = 0;
  let limit = firstMax;

  items.forEach((item) => {
    const height = heightFor(item);
    if (current.length > 0 && used + height > limit) {
      pages.push(current);
      current = [];
      used = 0;
      limit = nextMax;
    }
    current.push(item);
    used += height;
  });

  if (current.length > 0) pages.push(current);
  return pages;
}

interface RebalanceShortTailOptions<T> {
  minItemsOnLastPage: number;
  minItemsOnPreviousPage?: number;
  maxItemsPerPage?: number;
  heightFor?: (item: T) => number;
  maxPageHeight?: number;
}

export function rebalanceShortTailPages<T>(
  pages: T[][],
  options: RebalanceShortTailOptions<T>,
) {
  const cleaned = pages.map((page) => [...page]).filter((page) => page.length > 0);
  if (cleaned.length <= 1) return cleaned;

  const minItemsOnLastPage = Math.max(1, options.minItemsOnLastPage);
  const minItemsOnPreviousPage = Math.max(1, options.minItemsOnPreviousPage ?? minItemsOnLastPage);
  const pageHeight = (page: T[]) => page.reduce((sum, item) => sum + (options.heightFor ? options.heightFor(item) : 0), 0);
  const canMoveInto = (page: T[], item: T) => {
    if (options.maxItemsPerPage && page.length >= options.maxItemsPerPage) return false;
    if (options.heightFor && options.maxPageHeight && pageHeight(page) + options.heightFor(item) > options.maxPageHeight) return false;
    return true;
  };

  for (let idx = 0; idx < cleaned.length - 1; idx += 1) {
    const current = cleaned[idx];
    const next = cleaned[idx + 1];

    while (
      current.length < minItemsOnLastPage &&
      next.length > minItemsOnPreviousPage
    ) {
      const movable = next[0];
      if (!movable || !canMoveInto(current, movable)) break;
      next.shift();
      current.push(movable);
    }

    if (next.length === 0) {
      cleaned.splice(idx + 1, 1);
      idx -= 1;
    }
  }

  for (let idx = cleaned.length - 1; idx > 0; idx -= 1) {
    const current = cleaned[idx];
    const previous = cleaned[idx - 1];

    while (
      current.length < minItemsOnLastPage &&
      previous.length > minItemsOnPreviousPage
    ) {
      const movable = previous[previous.length - 1];
      if (!movable || !canMoveInto(current, movable)) break;
      previous.pop();
      current.unshift(movable);
    }

    if (previous.length === 0) {
      cleaned.splice(idx - 1, 1);
      idx = Math.min(idx, cleaned.length);
    }
  }

  return cleaned.filter((page) => page.length > 0);
}

export function packFindingsWithRebalance<T>(
  items: T[],
  heightFor: (item: T) => number,
  firstCap: number,
  nextCap: number,
  minFill = 0.7,
) {
  const pages: T[][] = [];
  const caps: number[] = [];

  let current: T[] = [];
  let used = 0;
  let cap = firstCap;

  const pushPage = () => {
    if (current.length > 0) {
      pages.push(current);
      caps.push(cap);
    }
    current = [];
    used = 0;
    cap = nextCap;
  };

  items.forEach((item) => {
    const h = heightFor(item);
    if (current.length > 0 && used + h > cap) {
      pushPage();
    }
    current.push(item);
    used += h;
  });
  pushPage();

  const pageHeight = (page: T[]) => page.reduce((sum, item) => sum + heightFor(item), 0);

  const rebalance = () => {
    if (pages.length <= 1) return;
    while (pages.length > 1) {
      const lastIdx = pages.length - 1;
      const prevIdx = lastIdx - 1;
      const lastCap = caps[lastIdx];
      const prevCap = caps[prevIdx];
      const lastHeight = pageHeight(pages[lastIdx]);
      const prevHeight = pageHeight(pages[prevIdx]);
      const fill = lastHeight / lastCap;
      if (fill >= minFill) break;
      const movable = pages[prevIdx][pages[prevIdx].length - 1];
      if (!movable) break;
      const moveH = heightFor(movable);
      if (lastHeight + moveH > lastCap) break;
      // move one item
      pages[prevIdx].pop();
      pages[lastIdx].unshift(movable);
      // if prev page emptied, drop it
      if (pages[prevIdx].length === 0) {
        pages.splice(prevIdx, 1);
        caps.splice(prevIdx, 1);
      }
    }
  };

  rebalance();
  return pages;
}
