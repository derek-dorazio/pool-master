import { useState, useRef, useEffect } from 'react';
import { Minimize2, Maximize2, Send, ChevronDown } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import { useChatMessages, useSendChatMessage, type ChatMessage } from './hooks/use-chat';

function formatTime(dateString: string): string {
  return new Date(dateString).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}

function SystemMessageRow({ message }: { message: ChatMessage }) {
  return (
    <div className="flex justify-center py-1">
      <span className="rounded-full bg-muted px-3 py-0.5 text-[11px] text-muted-foreground">
        {message.content}
      </span>
    </div>
  );
}

function ChatBubble({ message }: { message: ChatMessage }) {
  return (
    <div className={cn('flex gap-2', message.isOwn && 'flex-row-reverse')}>
      {!message.isOwn && (
        <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-muted text-[10px] font-medium">
          {message.authorInitials}
        </div>
      )}
      <div
        className={cn(
          'max-w-[75%] rounded-lg px-3 py-1.5',
          message.isOwn ? 'bg-primary text-primary-foreground' : 'bg-muted',
        )}
      >
        {!message.isOwn && (
          <p className="text-[10px] font-medium mb-0.5">{message.authorName}</p>
        )}
        <p className="text-sm">{message.content}</p>
        <p className={cn('text-[10px] mt-0.5', message.isOwn ? 'text-primary-foreground/70' : 'text-muted-foreground')}>
          {formatTime(message.createdAt)}
        </p>
      </div>
    </div>
  );
}

interface ChatPanelProps {
  contestId: string;
  participantCount?: number;
  disabled?: boolean;
}

export function ChatPanel({ contestId, participantCount = 0, disabled }: ChatPanelProps) {
  const [collapsed, setCollapsed] = useState(false);
  const [input, setInput] = useState('');
  const [autoScroll, setAutoScroll] = useState(true);
  const listRef = useRef<HTMLDivElement>(null);
  const { data: messages = [] } = useChatMessages(contestId);
  const sendMessage = useSendChatMessage(contestId);

  useEffect(() => {
    if (autoScroll && listRef.current) {
      listRef.current.scrollTop = listRef.current.scrollHeight;
    }
  }, [messages, autoScroll]);

  function handleScroll() {
    if (!listRef.current) return;
    const { scrollTop, scrollHeight, clientHeight } = listRef.current;
    setAutoScroll(scrollHeight - scrollTop - clientHeight < 50);
  }

  function handleSend(e: React.FormEvent) {
    e.preventDefault();
    if (!input.trim() || disabled) return;
    sendMessage.mutate(input.trim());
    setInput('');
    setAutoScroll(true);
  }

  return (
    <div className={cn('flex flex-col rounded-lg border bg-card', collapsed ? 'h-12' : 'h-96')}>
      <div className="flex h-12 shrink-0 items-center justify-between border-b px-4">
        <span className="text-sm font-medium">
          Chat {participantCount > 0 && `(${participantCount} online)`}
        </span>
        <Button variant="ghost" size="sm" className="h-7 w-7 p-0" onClick={() => setCollapsed(!collapsed)}>
          {collapsed ? <Maximize2 className="h-4 w-4" /> : <Minimize2 className="h-4 w-4" />}
        </Button>
      </div>

      {!collapsed && (
        <>
          <div
            ref={listRef}
            className="flex-1 overflow-y-auto px-3 py-2 space-y-2"
            onScroll={handleScroll}
          >
            {messages.map((msg) =>
              msg.type === 'system' ? (
                <SystemMessageRow key={msg.id} message={msg} />
              ) : (
                <ChatBubble key={msg.id} message={msg} />
              ),
            )}
          </div>

          {!autoScroll && (
            <div className="flex justify-center px-3 pb-1">
              <Button
                variant="secondary"
                size="sm"
                className="h-6 text-[11px]"
                onClick={() => {
                  setAutoScroll(true);
                  listRef.current?.scrollTo({ top: listRef.current.scrollHeight, behavior: 'smooth' });
                }}
              >
                <ChevronDown className="h-3 w-3 mr-1" />
                Scroll to bottom
              </Button>
            </div>
          )}

          <form onSubmit={handleSend} className="flex gap-2 border-t px-3 py-2">
            <Input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder={disabled ? 'Chat closed' : 'Type a message...'}
              disabled={disabled}
              maxLength={500}
              className="h-8 text-sm"
            />
            <Button type="submit" size="sm" disabled={!input.trim() || disabled || sendMessage.isPending}>
              <Send className="h-4 w-4" />
            </Button>
          </form>
        </>
      )}
    </div>
  );
}
