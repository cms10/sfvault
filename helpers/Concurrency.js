class Concurrency {
  /** Like Promise.all(items.map(worker)) but with at most `limit` workers running at once; keeps order. */
  static async map(items, limit, worker) {
    const results = new Array(items.length);
    let next = 0;

    const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (next < items.length) {
        const index = next++;
        results[index] = await worker(items[index], index);
      }
    });

    await Promise.all(runners);
    return results;
  }
}

module.exports = Concurrency;
