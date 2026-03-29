import { renderTemplate, renderNotification } from '../../../packages/core-api/src/modules/notifications/core/template-renderer';

describe('TemplateRenderer', () => {
  describe('renderTemplate', () => {
    it('replaces variables with data', () => {
      const result = renderTemplate('Hello {{name}}, your score is {{score}}', {
        name: 'Alex',
        score: 245,
      });
      expect(result).toBe('Hello Alex, your score is 245');
    });

    it('replaces missing variables with empty string', () => {
      const result = renderTemplate('Hello {{name}}, rank {{rank}}', { name: 'Alex' });
      expect(result).toBe('Hello Alex, rank ');
    });

    it('handles null/undefined values', () => {
      const result = renderTemplate('Value: {{val}}', { val: null });
      expect(result).toBe('Value: ');
    });

    it('leaves template unchanged with no data', () => {
      const result = renderTemplate('No variables here', {});
      expect(result).toBe('No variables here');
    });

    it('handles multiple occurrences of same variable', () => {
      const result = renderTemplate('{{name}} won! Congrats {{name}}!', { name: 'Tiger' });
      expect(result).toBe('Tiger won! Congrats Tiger!');
    });
  });

  describe('renderNotification', () => {
    it('renders all channels when templates provided', () => {
      const result = renderNotification(
        {
          pushTitle: 'You won {{contest_name}}!',
          pushBody: 'Score: {{score}}',
          emailSubject: 'Winner — {{contest_name}}',
          emailText: 'You won with {{score}} points',
          inAppTitle: 'Winner',
          inAppBody: '{{score}} points',
        },
        { contest_name: 'Masters Pool', score: 245 },
      );

      expect(result.push?.title).toBe('You won Masters Pool!');
      expect(result.push?.body).toBe('Score: 245');
      expect(result.email?.subject).toBe('Winner — Masters Pool');
      expect(result.inApp?.title).toBe('Winner');
      expect(result.inApp?.body).toBe('245 points');
    });

    it('returns undefined for channels without templates', () => {
      const result = renderNotification(
        { inAppTitle: 'Test', inAppBody: 'Body' },
        {},
      );

      expect(result.push).toBeUndefined();
      expect(result.email).toBeUndefined();
      expect(result.sms).toBeUndefined();
      expect(result.inApp).toBeDefined();
    });
  });
});
