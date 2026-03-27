import { useState } from 'react';
import { DollarSign, Clock, Gavel } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';

interface AuctionState {
  currentNomination: {
    participantId: string;
    participantName: string;
    position: string;
    team: string;
    estimatedValue: number;
  } | null;
  currentBid: number;
  highBidder: string;
  highBidderName: string;
  bidTimeLeft: number;
  isMyTurnToNominate: boolean;
  myBudget: number;
  totalBudget: number;
  auctionLog: Array<{
    participantName: string;
    winnerName: string;
    price: number;
  }>;
}

interface AuctionPanelProps {
  state: AuctionState;
  onBid: (amount: number) => void;
  onNominate: (participantId: string) => void;
  isBidding: boolean;
}

export function AuctionPanel({ state, onBid, isBidding }: AuctionPanelProps) {
  const [customBid, setCustomBid] = useState('');

  const canBid = state.currentNomination &&
    state.highBidder !== 'me' &&
    state.myBudget > state.currentBid;

  const nextBid = state.currentBid + 1;

  function submitBid(amount: number) {
    if (amount > state.myBudget) return;
    onBid(amount);
  }

  return (
    <div className="flex flex-col h-full">
      {/* Budget bar */}
      <div className="p-3 border-b">
        <div className="flex items-center justify-between text-sm mb-1">
          <span className="font-medium">Budget</span>
          <span>${state.myBudget} / ${state.totalBudget}</span>
        </div>
        <div className="h-2 rounded-full bg-muted overflow-hidden">
          <div
            className="h-full bg-green-500 rounded-full transition-all"
            style={{ width: `${(state.myBudget / state.totalBudget) * 100}%` }}
          />
        </div>
      </div>

      {/* Auction stage */}
      <div className="flex-1 p-4">
        {state.currentNomination ? (
          <Card className="mb-4">
            <CardContent className="p-6 text-center space-y-3">
              <p className="text-xs text-muted-foreground uppercase tracking-wider">Now Bidding</p>
              <h2 className="text-2xl font-bold">{state.currentNomination.participantName}</h2>
              <div className="flex items-center justify-center gap-2 text-sm text-muted-foreground">
                <Badge variant="outline">{state.currentNomination.position}</Badge>
                <span>{state.currentNomination.team}</span>
                <span>Est: ${state.currentNomination.estimatedValue}</span>
              </div>

              <div className="pt-4 border-t space-y-2">
                <div className="flex items-center justify-center gap-4">
                  <div className="text-center">
                    <p className="text-3xl font-bold text-primary">${state.currentBid}</p>
                    <p className="text-xs text-muted-foreground">Current Bid</p>
                  </div>
                  <div className="text-center">
                    <p className="text-sm font-medium">{state.highBidderName}</p>
                    <p className="text-xs text-muted-foreground">High Bidder</p>
                  </div>
                  <div className="text-center">
                    <div className="flex items-center gap-1">
                      <Clock className="h-4 w-4" />
                      <span className={`text-lg font-mono font-bold ${state.bidTimeLeft <= 5 ? 'text-red-600 animate-pulse' : ''}`}>
                        {state.bidTimeLeft}s
                      </span>
                    </div>
                    <p className="text-xs text-muted-foreground">Time Left</p>
                  </div>
                </div>
              </div>

              {/* Bidding controls */}
              {canBid && (
                <div className="pt-4 space-y-2">
                  <div className="flex items-center gap-2 justify-center">
                    <Button size="sm" variant="outline" onClick={() => submitBid(nextBid)} disabled={isBidding}>
                      +$1
                    </Button>
                    <Button size="sm" variant="outline" onClick={() => submitBid(state.currentBid + 5)} disabled={isBidding}>
                      +$5
                    </Button>
                    <Button size="sm" variant="outline" onClick={() => submitBid(state.currentBid + 10)} disabled={isBidding}>
                      +$10
                    </Button>
                    <div className="flex gap-1">
                      <Input
                        type="number"
                        placeholder="$"
                        className="w-16 h-8 text-sm"
                        value={customBid}
                        onChange={(e) => setCustomBid(e.target.value)}
                      />
                      <Button
                        size="sm"
                        onClick={() => { submitBid(parseInt(customBid)); setCustomBid(''); }}
                        disabled={isBidding || !customBid}
                      >
                        Bid
                      </Button>
                    </div>
                  </div>
                  <p className="text-xs text-muted-foreground">Your bid: ${nextBid}</p>
                </div>
              )}

              {state.highBidder === 'me' && (
                <p className="text-sm font-medium text-green-600">You are the high bidder!</p>
              )}
            </CardContent>
          </Card>
        ) : state.isMyTurnToNominate ? (
          <div className="text-center py-8 space-y-3">
            <Gavel className="h-8 w-8 text-primary mx-auto" />
            <p className="font-medium">Your turn to nominate!</p>
            <p className="text-sm text-muted-foreground">Select a player from the available list to start bidding.</p>
          </div>
        ) : (
          <div className="text-center py-8">
            <p className="text-sm text-muted-foreground">Waiting for nomination...</p>
          </div>
        )}

        {/* Auction log */}
        <div>
          <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2">Auction Log</h3>
          <div className="space-y-1 max-h-48 overflow-y-auto">
            {state.auctionLog.map((entry, i) => (
              <div key={i} className="flex items-center justify-between text-sm py-1">
                <span>{entry.participantName}</span>
                <span className="text-muted-foreground">{entry.winnerName} — ${entry.price}</span>
              </div>
            ))}
            {state.auctionLog.length === 0 && (
              <p className="text-xs text-muted-foreground">No completed auctions yet.</p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
