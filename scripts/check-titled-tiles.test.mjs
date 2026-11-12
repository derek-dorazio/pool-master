import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { countTitledTiles } from './check-titled-tiles.mjs';

describe('check-titled-tiles (#1562)', () => {
  it('counts a Tile that holds its own Heading, Eyebrow, SectionTitle or h1 to h6 title', () => {
    assert.equal(countTitledTiles('<Tile><Heading level={3}>Caps</Heading><p>x</p></Tile>'), 1);
    assert.equal(countTitledTiles('<Tile><div><Eyebrow>User</Eyebrow></div></Tile>'), 1);
    assert.equal(countTitledTiles('<Tile padding="lg"><h2>Plans</h2></Tile>'), 1);
    assert.equal(countTitledTiles('<Tile><SectionTitle title="Caps" /></Tile>'), 1);
  });

  it('leaves an untitled Tile alone, and a SectionCard, whose title is its own', () => {
    assert.equal(countTitledTiles('<Tile><p>Body</p></Tile>'), 0);
    assert.equal(countTitledTiles('<SectionCard title="Caps"><Heading level={4}>x</Heading></SectionCard>'), 0);
  });

  it('counts a title once, for the Tile that holds it, not for a Tile around that one', () => {
    assert.equal(countTitledTiles('<Tile><Tile><Heading>Inner</Heading></Tile></Tile>'), 1);
    assert.equal(countTitledTiles('<Tile><Heading>Outer</Heading><Tile><Heading>Inner</Heading></Tile></Tile>'), 2);
  });
});
