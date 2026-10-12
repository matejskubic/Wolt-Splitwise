// Passed at deploy time with `--var` (GitHub environment variable), so `wrangler types` cannot see it.
interface Env {
  SplitwiseConsumerKey: string;
}
