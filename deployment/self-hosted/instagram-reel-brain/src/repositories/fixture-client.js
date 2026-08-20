export class FixtureQueryClient {
  constructor() {
    this.queries = [];
    this.results = [];
  }

  enqueue(result) {
    this.results.push(result);
  }

  async query(text, values = []) {
    this.queries.push({ text: String(text), values });
    if (/^\s*(BEGIN|COMMIT|ROLLBACK)\s*;?\s*$/i.test(String(text))) {
      return { rows: [], rowCount: 0 };
    }
    return this.results.shift() || { rows: [], rowCount: 0 };
  }
}
