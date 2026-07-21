// Cursor pagination. Every list endpoint returns
// {"data": [...], "next_cursor": "...", "has_more": bool}. A Page holds one
// response; `for await (const item of page)` walks EVERY page transparently,
// while `.data` is just the current page's items.

export class Page<T> implements AsyncIterable<T> {
  data: T[];
  nextCursor: string | null;
  hasMore: boolean;
  #fetchNext: (cursor: string) => Promise<Page<T>>;

  constructor(
    data: T[],
    nextCursor: string | null,
    hasMore: boolean,
    fetchNext: (cursor: string) => Promise<Page<T>>,
  ) {
    this.data = data;
    this.nextCursor = nextCursor;
    this.hasMore = hasMore;
    this.#fetchNext = fetchNext;
  }

  async getNextPage(): Promise<Page<T> | null> {
    if (!this.hasMore || !this.nextCursor) return null;
    return this.#fetchNext(this.nextCursor);
  }

  /** Iterate every item across every page, following cursors automatically. */
  async *[Symbol.asyncIterator](): AsyncIterator<T> {
    let page: Page<T> | null = this;
    while (page) {
      yield* page.data;
      page = await page.getNextPage();
    }
  }
}

export interface RawPage<T> {
  data: T[];
  next_cursor?: string | null;
  has_more?: boolean;
}

export function pageFromRaw<T>(
  raw: RawPage<T>,
  fetchNext: (cursor: string) => Promise<Page<T>>,
): Page<T> {
  return new Page(raw.data ?? [], raw.next_cursor ?? null, raw.has_more ?? false, fetchNext);
}
