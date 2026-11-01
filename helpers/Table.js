class Table {
  /**
   * @param {{ key: string, title: string }[]} columns
   * @param {object[]} rows
   */
  static render(columns, rows) {
    const cell = (row, key) => (row[key] === null || row[key] === undefined || row[key] === '' ? '-' : String(row[key]));
    const widths = columns.map((c) => Math.max(c.title.length, ...rows.map((r) => cell(r, c.key).length)));
    const line = (values) => values.map((v, i) => v.padEnd(widths[i])).join('  ').trimEnd();

    return [
      line(columns.map((c) => c.title)),
      line(widths.map((w) => '-'.repeat(w))),
      ...rows.map((r) => line(columns.map((c) => cell(r, c.key)))),
    ].join('\n');
  }
}

module.exports = Table;
