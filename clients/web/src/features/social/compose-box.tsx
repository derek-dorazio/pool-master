import { useState } from 'react';
import { Send } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Card, CardContent } from '@/components/ui/card';

interface ComposeBoxProps {
  onSubmit: (data: { content: string }) => void;
  isPending?: boolean;
}

export function ComposeBox({ onSubmit, isPending }: ComposeBoxProps) {
  const [content, setContent] = useState('');

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!content.trim()) return;

    onSubmit({ content: content.trim() });
    setContent('');
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
            <span className="text-xs text-muted-foreground">{content.length}/2000</span>
            <Button type="submit" size="sm" disabled={!content.trim() || isPending}>
              <Send className="h-4 w-4 mr-1" />
              Post
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}
