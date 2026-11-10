# BALLDONTLIE fixtures

What the BALLDONTLIE adapter's tests read, and the vendor document they are held to. The
adapter was built before any account existed, so everything here comes from the vendor's
published OpenAPI document, not from recorded traffic.

- `openapi/pga.yml` is the vendor's PGA TOUR document, vendored unchanged below a three-line
  header that names its source, date and hash. `npm run balldontlie:contract-check` says when
  the live document differs; `-- --update-spec` refreshes the copy, and the contract tests then
  show whether anything the adapter reads moved.
- `pga/doc-example-*.json` are the document's own response examples, verbatim. A contract test
  fails if the document's example changes and the fixture does not.
- The other `pga/*.json` files are written to the document's schemas to cover what the examples
  do not: a stroke-play tournament in progress (41), a final one (40), a scheduled one (42), one
  whose state the vendor calls `unknown` (43), a team-format one (44), their fields, the players'
  world rankings, and results with a cut, a withdrawal, a back-nine start and a finished round.
  Every one must fit the document's response schema (`pga-contract.test.ts`).

Values the document leaves as free strings are read as follows, and are the first things to
check against real responses: a result's `position` marks a golfer out with `CUT`, `WD` or `DQ`
(the first two are documented on the v1 results; `DQ` is assumed), and `thru` is `F`, a hole
count, or a hole count with `*` for a back-nine start.

When an account exists, replace or add fixtures with recorded responses and keep the
doc-example files: the pair shows where the vendor's document and its API disagree.
