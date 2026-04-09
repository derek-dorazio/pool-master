import { useEffect, useState } from 'react';
import { ArrowLeft, X, Send } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';
import {
  useConversations,
  useConversationMessages,
  useSendDirectMessage,
  useMarkConversationRead,
  type Conversation,
  type DirectMessage,
} from './hooks/use-messages';

function formatRelative(dateString: string): string {
  const diff = Date.now() - new Date(dateString).getTime();
  const m = Math.floor(diff / 60_000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h`;
  return `${Math.floor(h / 24)}d`;
}

function getDateLabel(dateString: string): string {
  const date = new Date(dateString);
  const today = new Date();
  const yesterday = new Date(today.getTime() - 86_400_000);
  if (date.toDateString() === today.toDateString()) return 'Today';
  if (date.toDateString() === yesterday.toDateString()) return 'Yesterday';
  return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

function ConversationRow({ conv, onClick }: { conv: Conversation; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="flex w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-accent"
    >
      <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-muted text-sm font-medium">
        {conv.participantInitials}
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center justify-between">
          <span className="text-sm font-medium">{conv.participantName}</span>
          <span className="text-[10px] text-muted-foreground">{formatRelative(conv.lastMessageAt)}</span>
        </div>
        <div className="flex items-center justify-between">
          <p className="truncate text-xs text-muted-foreground">{conv.lastMessage}</p>
          {conv.unreadCount > 0 && (
            <Badge variant="default" className="ml-1 h-5 min-w-5 justify-center rounded-full px-1.5 text-[10px]">
              {conv.unreadCount}
            </Badge>
          )}
        </div>
      </div>
    </button>
  );
}

function MessageBubble({ message }: { message: DirectMessage }) {
  return (
    <div className={cn('flex', message.isOwn ? 'justify-end' : 'justify-start')}>
      <div
        className={cn(
          'max-w-[75%] rounded-lg px-3 py-1.5',
          message.isOwn ? 'bg-primary text-primary-foreground' : 'bg-muted',
        )}
      >
        <p className="text-sm">{message.content}</p>
        <div className={cn('flex items-center justify-end gap-1 mt-0.5', message.isOwn ? 'text-primary-foreground/70' : 'text-muted-foreground')}>
          <span className="text-[10px]">
            {new Date(message.createdAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}
          </span>
          {message.isOwn && (
            <span className="text-[10px]">{message.read ? '✓✓' : '✓'}</span>
          )}
        </div>
      </div>
    </div>
  );
}

function ConversationThread({ conversationId, participantName, onBack }: { conversationId: string; participantName: string; onBack: () => void }) {
  const { data: messages = [], isLoading } = useConversationMessages(conversationId);
  const sendMessage = useSendDirectMessage(conversationId);
  const markRead = useMarkConversationRead(conversationId);
  const [input, setInput] = useState('');

  useEffect(() => {
    markRead.mutate();
  }, [conversationId, markRead]);

  function handleSend(e: React.FormEvent) {
    e.preventDefault();
    if (!input.trim()) return;
    sendMessage.mutate(input.trim());
    setInput('');
  }

  // Group messages by date for dividers
  let lastDateLabel = '';

  return (
    <div className="flex h-full flex-col">
      <div className="flex h-12 items-center gap-2 border-b px-4">
        <Button variant="ghost" size="sm" className="h-7 w-7 p-0" onClick={onBack}>
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <span className="text-sm font-medium">{participantName}</span>
      </div>

      <div className="flex-1 overflow-y-auto px-4 py-3 space-y-2">
        {isLoading ? (
          <div className="space-y-3">
            <Skeleton className="h-8 w-3/4" />
            <Skeleton className="ml-auto h-8 w-2/3" />
            <Skeleton className="h-8 w-3/4" />
          </div>
        ) : (
          messages.map((msg) => {
            const dateLabel = getDateLabel(msg.createdAt);
            const showDivider = dateLabel !== lastDateLabel;
            lastDateLabel = dateLabel;
            return (
              <div key={msg.id}>
                {showDivider && (
                  <div className="flex justify-center py-2">
                    <span className="rounded-full bg-muted px-3 py-0.5 text-[10px] text-muted-foreground">{dateLabel}</span>
                  </div>
                )}
                <MessageBubble message={msg} />
              </div>
            );
          })
        )}
      </div>

      <form onSubmit={handleSend} className="flex gap-2 border-t px-4 py-2">
        <Input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Type a message..."
          maxLength={500}
          className="h-8 text-sm"
        />
        <Button type="submit" size="sm" disabled={!input.trim() || sendMessage.isPending}>
          <Send className="h-4 w-4" />
        </Button>
      </form>
    </div>
  );
}

interface DMDrawerProps {
  open: boolean;
  onClose: () => void;
}

export function DMDrawer({ open, onClose }: DMDrawerProps) {
  const { data: conversations = [], isLoading } = useConversations();
  const [selectedConv, setSelectedConv] = useState<Conversation | null>(null);
  const [search, setSearch] = useState('');

  if (!open) return null;

  const totalUnread = conversations.reduce((sum, c) => sum + c.unreadCount, 0);
  const filtered = search
    ? conversations.filter((c) => c.participantName.toLowerCase().includes(search.toLowerCase()))
    : conversations;

  return (
    <div className="fixed inset-y-0 right-0 z-50 flex w-full max-w-sm flex-col border-l bg-card shadow-lg">
      {selectedConv ? (
        <ConversationThread
          conversationId={selectedConv.id}
          participantName={selectedConv.participantName}
          onBack={() => setSelectedConv(null)}
        />
      ) : (
        <>
          <div className="flex h-12 items-center justify-between border-b px-4">
            <div className="flex items-center gap-2">
              <span className="text-sm font-semibold">Messages</span>
              {totalUnread > 0 && (
                <Badge variant="default" className="h-5 min-w-5 justify-center rounded-full px-1.5 text-[10px]">
                  {totalUnread}
                </Badge>
              )}
            </div>
            <div className="flex gap-1">
              <Button variant="ghost" size="sm" className="h-7 w-7 p-0" onClick={onClose}>
                <X className="h-4 w-4" />
              </Button>
            </div>
          </div>

          <div className="px-4 py-2">
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search conversations..."
              className="h-8 text-sm"
            />
          </div>

          <div className="flex-1 overflow-y-auto">
            {isLoading ? (
              <div className="space-y-2 px-4 py-2">
                {[1, 2, 3].map((i) => <Skeleton key={i} className="h-14 w-full" />)}
              </div>
            ) : filtered.length === 0 ? (
              <p className="px-4 py-8 text-center text-sm text-muted-foreground">No conversations</p>
            ) : (
              filtered.map((conv) => (
                <ConversationRow key={conv.id} conv={conv} onClick={() => setSelectedConv(conv)} />
              ))
            )}
          </div>
        </>
      )}
    </div>
  );
}
