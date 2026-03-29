/**
 * TemplateRenderer — renders notification templates with variable substitution.
 *
 * Supports Mustache-style {{variable}} syntax.
 */

export interface RenderedContent {
  title: string;
  body: string;
  subject?: string;
}

/**
 * Renders a template string with variable substitution.
 * Variables are in {{variableName}} format.
 */
export function renderTemplate(template: string, data: Record<string, unknown>): string {
  return template.replace(/\{\{(\w+)\}\}/g, (_match, key: string) => {
    const value = data[key];
    if (value === undefined || value === null) return '';
    if (value instanceof Date) return value.toLocaleDateString();
    return String(value);
  });
}

/**
 * Renders all channel templates for a notification.
 */
export function renderNotification(
  templates: {
    pushTitle?: string;
    pushBody?: string;
    emailSubject?: string;
    emailHtml?: string;
    emailText?: string;
    inAppTitle?: string;
    inAppBody?: string;
    smsBody?: string;
  },
  data: Record<string, unknown>,
): {
  push?: RenderedContent;
  email?: RenderedContent & { html?: string; text?: string };
  inApp?: RenderedContent;
  sms?: { body: string };
} {
  return {
    push: templates.pushTitle ? {
      title: renderTemplate(templates.pushTitle, data),
      body: renderTemplate(templates.pushBody ?? '', data),
    } : undefined,

    email: templates.emailSubject ? {
      title: renderTemplate(templates.emailSubject, data),
      body: renderTemplate(templates.emailText ?? '', data),
      subject: renderTemplate(templates.emailSubject, data),
      html: templates.emailHtml ? renderTemplate(templates.emailHtml, data) : undefined,
      text: templates.emailText ? renderTemplate(templates.emailText, data) : undefined,
    } : undefined,

    inApp: templates.inAppTitle ? {
      title: renderTemplate(templates.inAppTitle, data),
      body: renderTemplate(templates.inAppBody ?? '', data),
    } : undefined,

    sms: templates.smsBody ? {
      body: renderTemplate(templates.smsBody, data),
    } : undefined,
  };
}
