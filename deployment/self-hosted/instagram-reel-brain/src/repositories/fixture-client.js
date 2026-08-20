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
    return this.results.shift() || { rows: [], rowCount: 0 };
  }
}
