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
