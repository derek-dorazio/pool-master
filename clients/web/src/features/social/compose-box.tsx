import { useState } from 'react';
import { Send } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Input } from '@/components/ui/input';
import { Card, CardContent } from '@/components/ui/card';

interface ComposeBoxProps {
  onSubmit: (data: { content: string; poll?: { question: string; options: string[]; expiresIn: string } }) => void;
  isPending?: boolean;
}

export function ComposeBox({ onSubmit, isPending }: ComposeBoxProps) {
  const [content, setContent] = useState('');
  const [showPoll, setShowPoll] = useState(false);
  const [pollQuestion, setPollQuestion] = useState('');
  const [pollOptions, setPollOptions] = useState(['', '']);
  const [pollExpiry, setPollExpiry] = useState('24h');

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!content.trim()) return;

    const poll = showPoll && pollQuestion.trim()
      ? { question: pollQuestion.trim(), options: pollOptions.filter((o) => o.trim()), expiresIn: pollExpiry }
      : undefined;

    onSubmit({ content: content.trim(), poll });
    setContent('');
    setShowPoll(false);
    setPollQuestion('');
    setPollOptions(['', '']);
  }

  function addOption() {
    if (pollOptions.length < 5) setPollOptions([...pollOptions, '']);
  }

  function updateOption(index: number, value: string) {
    const updated = [...pollOptions];
    updated[index] = value;
    setPollOptions(updated);
  }

  return (
    <Card>
      <CardContent className="p-4">
        <form onSubmit={handleSubmit}>
          <Textarea
            placeholder="What's on your mind?"
            value={content}
            onChange={(e) => setContent(e.target.value)}
            rows={3}
            maxLength={2000}
          />
          <div className="flex items-center justify-between mt-2">
            <div className="flex items-center gap-2">
              <Button
                type="button"
                variant={showPoll ? 'secondary' : 'ghost'}
                size="sm"
                onClick={() => setShowPoll(!showPoll)}
              >
                {showPoll ? 'Remove Poll' : 'Add Poll'}
              </Button>
              <span className="text-xs text-muted-foreground">{content.length}/2000</span>
            </div>
            <Button type="submit" size="sm" disabled={!content.trim() || isPending}>
              <Send className="h-4 w-4 mr-1" />
              Post
            </Button>
          </div>

          {showPoll && (
            <div className="mt-3 space-y-2 rounded-md border p-3">
              <Input
                placeholder="Poll question"
                value={pollQuestion}
                onChange={(e) => setPollQuestion(e.target.value)}
              />
              {pollOptions.map((opt, i) => (
                <Input
                  key={i}
                  placeholder={`Option ${i + 1}`}
                  value={opt}
                  onChange={(e) => updateOption(i, e.target.value)}
                />
              ))}
              <div className="flex items-center gap-2">
                {pollOptions.length < 5 && (
                  <Button type="button" variant="ghost" size="sm" onClick={addOption}>
                    + Add Option
                  </Button>
                )}
                <select
                  value={pollExpiry}
                  onChange={(e) => setPollExpiry(e.target.value)}
                  className="h-8 rounded-md border border-input bg-background px-2 text-xs"
                >
                  <option value="1h">1 hour</option>
                  <option value="12h">12 hours</option>
                  <option value="24h">24 hours</option>
                  <option value="1w">1 week</option>
                </select>
              </div>
            </div>
          )}
        </form>
      </CardContent>
    </Card>
  );
}
