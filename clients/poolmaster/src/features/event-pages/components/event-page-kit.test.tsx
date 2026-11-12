import { Sport } from '@poolmaster/shared/domain';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { describe, expect, it } from 'vitest';
import { LandingDisclaimer } from './landing-disclaimer';
import { LandingSection } from './landing-section';
import { NextUpCard } from './next-up-card';
import { PhotoHero } from './photo-hero';
import { StartButton } from './start-button';

describe('StartButton', () => {
  it('sends the visitor to /start with the event page and the setup they chose', () => {
    render(
      <MemoryRouter>
        <StartButton request={{ sport: Sport.AMERICAN_FOOTBALL, slug: 'super-bowl', templateId: 'tpl-1' }} testId="start">Start your league</StartButton>
      </MemoryRouter>,
    );

    expect(screen.getByTestId('start')).toHaveAttribute('href', '/start?sport=american-football&page=super-bowl&template=tpl-1');
    expect(screen.getByTestId('start')).toHaveTextContent('Start your league');
  });
});

describe('LandingSection', () => {
  it('heads its content with the eyebrow, display title and intro, at the address a menu link jumps to', () => {
    render(
      <LandingSection eyebrow="The cards" id="card-types" intro="One stat line a sport." testId="section" title="Five ways to score">
        <p>Body</p>
      </LandingSection>,
    );

    expect(screen.getByTestId('section')).toHaveAttribute('id', 'card-types');
    expect(screen.getByText('The cards')).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 2, name: 'Five ways to score' })).toHaveClass('font-display');
    expect(screen.getByText('One stat line a sport.')).toBeInTheDocument();
    expect(screen.getByText('Body')).toBeInTheDocument();
  });

  it('leaves out the eyebrow and intro when it has none', () => {
    render(<LandingSection testId="section" title="Ready before kickoff"><p>Body</p></LandingSection>);

    expect(screen.getByTestId('section')).toHaveTextContent(/^Ready before kickoffBody$/);
  });
});

describe('PhotoHero', () => {
  it("heads the hero with the sport's photo, shared with its email, above the hero's content", () => {
    render(<PhotoHero sport={Sport.AMERICAN_FOOTBALL}><h1>Super Bowl</h1></PhotoHero>);

    expect(screen.getByTestId('event-page-photo')).toHaveAttribute('src', '/email/sports/american-football.jpg');
    expect(screen.getByTestId('event-page-photo')).toHaveAttribute('alt', '');
    expect(screen.getByRole('heading', { name: 'Super Bowl' })).toBeInTheDocument();
  });
});

describe('NextUpCard', () => {
  it("names what comes next and links to its page", () => {
    render(
      <MemoryRouter>
        <NextUpCard actionLabel="See ways to play" name="Super Bowl" testId="next" to="/play/american-football/super-bowl" />
      </MemoryRouter>,
    );

    expect(screen.getByText('Next up')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Super Bowl' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'See ways to play' })).toHaveAttribute('href', '/play/american-football/super-bowl');
  });
});

describe('LandingDisclaimer', () => {
  it('closes the page with its small print', () => {
    render(<LandingDisclaimer testId="disclaimer">Not affiliated with the NFL or any sports league.</LandingDisclaimer>);

    expect(screen.getByTestId('disclaimer')).toHaveTextContent('Not affiliated with the NFL or any sports league.');
    expect(screen.getByTestId('disclaimer')).toHaveClass('text-xs');
  });
});
