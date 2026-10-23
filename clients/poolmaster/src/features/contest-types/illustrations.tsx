import type { SelectionType, Sport } from '@poolmaster/shared/domain';
import type { ReactNode } from 'react';
import { cn } from '@/features/shared/ui';

/** The illustration palette, from the theme layer's `--illustration-*` tokens. */
const ink = 'var(--illustration-ink)';
const paper = 'var(--illustration-paper)';
/** Marks drawn on paper (a ball's pattern, a flag's squares): dark in both themes, as paper stays light. */
const paperInk = 'var(--illustration-paper-ink)';
const gold = 'var(--illustration-gold)';
const goldInk = 'var(--illustration-gold-ink)';
const sky = 'var(--illustration-sky)';
const grass = 'var(--illustration-grass)';
const grassDark = 'var(--illustration-grass-dark)';
const dirt = 'var(--illustration-dirt)';
const sand = 'var(--illustration-sand)';
const red = 'var(--illustration-red)';
const orange = 'var(--illustration-orange)';
const ice = 'var(--illustration-ice)';
const court = 'var(--illustration-court)';
const brown = 'var(--illustration-brown)';
const asphalt = 'var(--illustration-asphalt)';
const road = 'var(--illustration-road)';
const puck = 'var(--illustration-puck)';
const puckTop = 'var(--illustration-puck-top)';
const tennisBall = 'var(--illustration-tennis-ball)';
const tint = 'var(--illustration-tint)';
const chip = 'var(--illustration-chip)';
const card = 'var(--illustration-card)';
const line = 'var(--illustration-line)';
const muted = 'var(--illustration-muted)';

interface Scene {
  background: string;
  art: ReactNode;
}

/** A sport's scene is announced where it stands alone, so it carries a label. */
interface SportScene extends Scene {
  label: string;
}

function checker(columns: number, rows: number, size: number) {
  return Array.from({ length: rows * columns }, (_, index) => {
    const row = Math.floor(index / columns);
    const column = index % columns;
    return <rect fill={(row + column) % 2 ? paper : paperInk} height={size} key={index} width={size} x={column * size} y={row * size} />;
  });
}

function pill(x: number, y: number, width: number, fill: string, key?: string | number) {
  return <rect fill={fill} height="12" key={key} rx="6" width={width} x={x} y={y} />;
}

/** Each sport's scene. A `Record` over the sports, so a new sport needs its picture (#878). */
const SPORT_SCENES: Record<Sport, SportScene> = {
  GOLF: {
    background: sky,
    label: 'A golf flag on the green',
    art: (
      <>
        <circle cx="130" cy="24" fill={gold} r="11" />
        <path d="M0 68 Q40 50 82 60 T160 56 V100 H0Z" fill={grass} />
        <path d="M0 84 Q60 72 160 80 V100 H0Z" fill={grassDark} />
        <ellipse cx="96" cy="66" fill={ink} rx="9" ry="3" />
        <line stroke={ink} strokeWidth="2.5" x1="96" x2="96" y1="66" y2="20" />
        <path d="M97 20 L122 27 L97 35Z" fill={gold} />
        <circle cx="70" cy="70" fill={paper} r="4.5" stroke={paperInk} strokeWidth="1.2" />
      </>
    ),
  },
  HORSE_RACING: {
    background: sand,
    label: 'A horseshoe by the racetrack rail',
    art: (
      <>
        <rect fill={dirt} height="34" width="160" y="66" />
        <path d="M0 74 Q80 66 160 74" fill="none" opacity=".6" stroke={paper} strokeWidth="1.5" />
        <line stroke={paper} strokeWidth="3" x1="0" x2="160" y1="50" y2="50" />
        {[12, 40, 68, 96, 124, 152].map((x) => <line key={x} stroke={paper} strokeWidth="3" x1={x} x2={x} y1="50" y2="66" />)}
        <rect fill={paper} height="48" width="5" x="132" y="18" />
        <circle cx="134.5" cy="18" fill={red} r="7" />
        <path d="M60 22 C46 42 50 70 78 72 C106 70 110 42 96 22" fill="none" stroke={gold} strokeLinecap="round" strokeWidth="11" />
        {[[55, 36], [54, 50], [59, 62], [101, 36], [102, 50], [97, 62]].map(([x, y]) => <circle cx={x} cy={y} fill={ink} key={`${x}-${y}`} r="1.8" />)}
      </>
    ),
  },
  AUTO_RACING: {
    background: sky,
    label: 'A checkered flag over the track',
    art: (
      <>
        <path d="M0 100 L0 72 Q80 56 160 70 L160 100Z" fill={asphalt} />
        <path d="M8 86 Q80 70 152 82" fill="none" stroke={gold} strokeDasharray="8 6" strokeWidth="2" />
        <line stroke={ink} strokeWidth="3" x1="44" x2="44" y1="14" y2="74" />
        <g transform="translate(45 15) skewY(8)">
          {checker(6, 4, 9)}
          <rect fill="none" height="36" stroke={paperInk} strokeWidth="1" width="54" />
        </g>
        <circle cx="128" cy="26" fill={red} r="9" />
      </>
    ),
  },
  CYCLING: {
    background: sky,
    label: 'A road bicycle',
    art: (
      <>
        <rect fill={grass} height="20" width="160" y="80" />
        <line stroke={ink} strokeWidth="1.5" x1="0" x2="160" y1="80" y2="80" />
        <circle cx="50" cy="62" fill="none" r="17" stroke={ink} strokeWidth="3.5" />
        <circle cx="110" cy="62" fill="none" r="17" stroke={ink} strokeWidth="3.5" />
        <path d="M50 62 L78 62 L71 36 Z M78 62 L101 36 L71 36 M101 36 L110 62" fill="none" stroke={gold} strokeLinejoin="round" strokeWidth="4" />
        <path d="M101 36 L104 28 L114 30" fill="none" stroke={ink} strokeLinecap="round" strokeWidth="3" />
        <path d="M63 32 L78 32" stroke={ink} strokeLinecap="round" strokeWidth="4" />
        <circle cx="78" cy="62" fill={ink} r="4" />
      </>
    ),
  },
  RUNNING: {
    background: sky,
    label: 'A marathon finish line',
    art: (
      <>
        <path d="M68 42 L92 42 L150 100 L10 100Z" fill={road} />
        <path d="M80 46 L80 100" stroke={paper} strokeDasharray="6 6" strokeWidth="2" />
        <rect fill={grass} height="3" width="160" y="40" />
        <rect fill={ink} height="40" width="4" x="30" y="12" />
        <rect fill={ink} height="40" width="4" x="126" y="12" />
        <rect fill={gold} height="14" rx="2" width="104" x="28" y="12" />
        <text className="font-display" fill={goldInk} fontSize="10" fontWeight="900" textAnchor="middle" x="80" y="23">FINISH · 26.2</text>
        <path d="M18 60 Q80 72 142 60" fill="none" stroke={red} strokeWidth="2.5" />
      </>
    ),
  },
  BASKETBALL: {
    background: sand,
    label: 'A basketball and hoop',
    art: (
      <>
        <rect fill={paper} height="42" rx="3" stroke={paperInk} strokeWidth="2.5" width="62" x="84" y="10" />
        <rect fill="none" height="16" stroke={red} strokeWidth="2" width="22" x="104" y="28" />
        <ellipse cx="115" cy="54" fill="none" rx="14" ry="3.5" stroke={orange} strokeWidth="3" />
        <path d="M102 55 L107 74 M110 57 L111 75 M120 57 L119 75 M128 55 L123 74 M104 64 L126 64" opacity=".7" stroke={ink} strokeWidth="1" />
        <circle cx="48" cy="60" fill={orange} r="26" />
        <path d="M22 60 H74 M48 34 V86 M30 41 Q42 60 30 79 M66 41 Q54 60 66 79" fill="none" stroke={ink} strokeWidth="2" />
      </>
    ),
  },
  AMERICAN_FOOTBALL: {
    background: sky,
    label: 'A football and goalposts',
    art: (
      <>
        <rect fill={grass} height="38" width="160" y="62" />
        {[20, 60, 100, 140].map((x) => <line key={x} opacity=".7" stroke={paper} strokeWidth="1.5" x1={x} x2={x - 6} y1="62" y2="100" />)}
        <path d="M118 66 V40 M100 40 H136 M100 40 V10 M136 40 V10" fill="none" stroke={gold} strokeLinecap="round" strokeWidth="4" />
        <g transform="rotate(-25 56 56)">
          <ellipse cx="56" cy="56" fill={brown} rx="32" ry="19" />
          <path d="M40 56 H72" stroke={paper} strokeWidth="2.5" />
          {[44, 50, 56, 62, 68].map((x) => <path d={`M${x} 52 V60`} key={x} stroke={paper} strokeWidth="2" />)}
          <path d="M30 46 Q32 56 30 66 M82 46 Q80 56 82 66" fill="none" stroke={paper} strokeWidth="2.5" />
        </g>
      </>
    ),
  },
  HOCKEY: {
    background: ice,
    label: 'Crossed hockey sticks and a puck',
    art: (
      <>
        <line stroke={court} strokeWidth="5" x1="0" x2="160" y1="78" y2="78" />
        <line opacity=".8" stroke={red} strokeWidth="3" x1="80" x2="80" y1="0" y2="100" />
        <path d="M36 14 L96 74 L112 74" fill="none" stroke={ink} strokeLinecap="round" strokeLinejoin="round" strokeWidth="5" />
        <path d="M124 14 L64 74 L48 74" fill="none" stroke={gold} strokeLinecap="round" strokeLinejoin="round" strokeWidth="5" />
        <ellipse cx="80" cy="88" fill={puck} rx="13" ry="4.5" />
        <rect fill={puck} height="5" width="26" x="67" y="83" />
        <ellipse cx="80" cy="83" fill={puckTop} rx="13" ry="4.5" />
      </>
    ),
  },
  BASEBALL: {
    background: grass,
    label: 'A baseball diamond and ball',
    art: (
      <>
        <path d="M80 92 L42 54 L80 16 L118 54Z" fill={dirt} />
        <path d="M80 82 L52 54 L80 26 L108 54Z" fill={grassDark} />
        {[[80, 88], [46, 54], [80, 20], [114, 54]].map(([x, y]) => (
          <rect fill={paper} height="8" key={`${x}-${y}`} transform={`rotate(45 ${x} ${y})`} width="8" x={x - 4} y={y - 4} />
        ))}
        <circle cx="128" cy="76" fill={paper} r="18" stroke={paperInk} strokeWidth="1" />
        <path d="M116 62 Q124 76 116 90 M140 62 Q132 76 140 90" fill="none" stroke={red} strokeDasharray="2 2.5" strokeWidth="2" />
      </>
    ),
  },
  SOCCER: {
    background: sky,
    label: 'A soccer ball in front of the goal',
    art: (
      <>
        <rect fill={grass} height="30" width="160" y="70" />
        <path d="M18 70 V20 H142 V70" fill="none" stroke={paper} strokeWidth="4" />
        {[38, 58, 78, 98, 118].map((x) => <line key={x} opacity=".6" stroke={paper} strokeWidth=".8" x1={x} x2={x} y1="20" y2="70" />)}
        {[32, 44, 56].map((y) => <line key={y} opacity=".6" stroke={paper} strokeWidth=".8" x1="18" x2="142" y1={y} y2={y} />)}
        <circle cx="80" cy="72" fill={paper} r="20" stroke={paperInk} strokeWidth="1.5" />
        <path d="M80 64 L87.6 69.5 L84.7 78.5 L75.3 78.5 L72.4 69.5Z" fill={paperInk} />
        <path d="M80 64 V54 M87.6 69.5 L98 66 M84.7 78.5 L91 87 M75.3 78.5 L69 87 M72.4 69.5 L62 66" stroke={paperInk} strokeWidth="1.5" />
      </>
    ),
  },
  TENNIS: {
    background: sky,
    label: 'A tennis racket and ball',
    art: (
      <>
        <rect fill={court} height="44" width="160" y="56" />
        <path d="M0 56 H160 M80 56 V100 M20 100 L34 56 M140 100 L126 56" stroke={paper} strokeWidth="2" />
        <g transform="rotate(-35 64 44)">
          <ellipse cx="64" cy="34" fill="none" rx="20" ry="26" stroke={ink} strokeWidth="4" />
          {[-12, -6, 0, 6, 12].map((offset) => (
            <g key={offset}>
              <line stroke={ink} strokeWidth=".8" x1={64 + offset} x2={64 + offset} y1="10" y2="58" />
              <line stroke={ink} strokeWidth=".8" x1="45" x2="83" y1={34 + offset * 1.6} y2={34 + offset * 1.6} />
            </g>
          ))}
          <rect fill={gold} height="26" rx="2" width="6" x="61" y="60" />
        </g>
        <circle cx="118" cy="34" fill={tennisBall} r="13" stroke={ink} strokeWidth="1" />
        <path d="M107 27 Q118 34 107 42 M129 27 Q118 34 129 42" fill="none" stroke={paper} strokeWidth="2" />
      </>
    ),
  },
};

const DIGITS = [3, 7, 0, 9, 4, 1, 8, 2, 6, 5];

/** Each way to play drawn as the sheet a member fills in (#878). */
const FORMAT_SCENES: Record<SelectionType, Scene> = {
  TIERED: {
    background: tint,
    art: (
      <>
        {['A', 'B', 'C'].map((tier, row) => (
          <g key={tier}>
            <text className="font-display" fill={ink} fontSize="13" fontWeight="900" x="16" y={30 + row * 24}>{tier}</text>
            {[0, 1, 2, 3].map((column) => pill(34 + column * 30, 20 + row * 24, 26, column === [1, 3, 0][row] ? gold : chip, column))}
          </g>
        ))}
        <path d="M73 26 l4 4 l7 -8" fill="none" stroke={goldInk} strokeWidth="2" />
      </>
    ),
  },
  BUDGET_PICK: {
    background: tint,
    art: (
      <>
        {['$11.2k', '$8.4k', '$6.1k'].map((price, index) => (
          <g key={price}>
            <rect fill={card} height="46" rx="6" stroke={line} width="38" x={16 + index * 44} y="14" />
            <circle cx={35 + index * 44} cy="30" fill={chip} r="8" />
            <text fill={ink} fontSize="9" fontWeight="700" textAnchor="middle" x={35 + index * 44} y="54">{price}</text>
          </g>
        ))}
        <rect fill={chip} height="10" rx="5" width="128" x="16" y="70" />
        <rect fill={gold} height="10" rx="5" width="118" x="16" y="70" />
        <text fill={ink} fontSize="9" fontWeight="600" x="16" y="94">$25.7k of $28k cap</text>
      </>
    ),
  },
  RANDOM_DRAW: {
    background: tint,
    art: (
      <>
        <ellipse cx="80" cy="84" fill={court} rx="34" ry="7" />
        <path d="M54 84 L58 50 H102 L106 84Z" fill={court} />
        <rect fill={red} height="6" width="52" x="54" y="48" />
        {[[60, 20, -18], [86, 12, 10], [108, 26, 26]].map(([x, y, angle]) => (
          <g key={x} transform={`rotate(${angle} ${x + 12} ${y + 8})`}>
            <rect fill={paper} height="17" rx="2" stroke={paperInk} strokeWidth="1" width="26" x={x} y={y} />
            <line stroke={paperInk} x1={x + 5} x2={x + 21} y1={y + 7} y2={y + 7} />
            <line stroke={paperInk} x1={x + 5} x2={x + 16} y1={y + 11} y2={y + 11} />
          </g>
        ))}
        <path d="M30 30 l3 -8 l3 8 l8 3 l-8 3 l-3 8 l-3 -8 l-8 -3Z" fill={gold} />
      </>
    ),
  },
  PICK_EM: {
    background: tint,
    art: (
      <>
        <rect fill={card} height="84" rx="8" stroke={line} width="112" x="24" y="8" />
        {[true, false, true, true].map((home, row) => (
          <g key={row}>
            {pill(34, 18 + row * 18, 34, home ? gold : chip)}
            <text fill={muted} fontSize="8" fontWeight="700" textAnchor="middle" x="80" y={27 + row * 18}>vs</text>
            {pill(92, 18 + row * 18, 34, home ? chip : gold)}
          </g>
        ))}
      </>
    ),
  },
  BRACKET: {
    background: tint,
    art: (
      <>
        <path d="M10 14 H28 V26 H10 M10 38 H28 V26 H44 V50 H56 M10 62 H28 V74 H10 M28 74 H44 V50" fill="none" stroke={ink} strokeWidth="2" />
        <path d="M150 14 H132 V26 H150 M150 38 H132 V26 H116 V50 H104 M150 62 H132 V74 H150 M132 74 H116 V50" fill="none" stroke={ink} strokeWidth="2" />
        <path d="M66 34 H94 V44 Q94 60 80 62 Q66 60 66 44Z" fill={gold} />
        <path d="M66 38 Q58 38 60 46 Q62 52 68 52 M94 38 Q102 38 100 46 Q98 52 92 52" fill="none" stroke={gold} strokeWidth="3" />
        <rect fill={gold} height="10" width="8" x="76" y="62" />
        <rect fill={ink} height="6" rx="1" width="24" x="68" y="72" />
      </>
    ),
  },
  SURVIVOR: {
    background: tint,
    art: (
      <>
        {[0, 1, 2, 3, 4].map((index) => {
          const x = 18 + index * 26;
          return index === 3 ? (
            <g key={index}>
              <circle cx={x + 10} cy="42" fill={gold} r="11" />
              <path d={`M${x + 10} 33 L${x + 18} 36 V42 Q${x + 18} 50 ${x + 10} 53 Q${x + 2} 50 ${x + 2} 42 V36Z`} fill={ink} />
              <path d={`M${x + 6} 42 l3 3 l6 -6`} fill="none" stroke={gold} strokeWidth="2" />
            </g>
          ) : (
            <g key={index}>
              <circle cx={x + 10} cy="42" fill={chip} r="11" />
              <path d={`M${x + 4} 36 l12 12 M${x + 16} 36 l-12 12`} stroke={red} strokeWidth="2.5" />
            </g>
          );
        })}
        <text className="font-display" fill={ink} fontSize="11" fontWeight="800" textAnchor="middle" x="80" y="80">Week 9 · 1 left standing</text>
      </>
    ),
  },
  SQUARES: {
    background: tint,
    art: (
      <>
        {DIGITS.flatMap((_, row) => DIGITS.map((__, column) => {
          const winner = row === 3 && column === 7;
          const taken = (row * 7 + column * 3) % 5 === 0;
          return (
            <rect
              fill={winner ? gold : taken ? ink : chip}
              height="6"
              key={`${row}-${column}`}
              opacity={taken && !winner ? 0.55 : 1}
              width="6"
              x={46 + column * 7}
              y={18 + row * 7}
            />
          );
        }))}
        {DIGITS.map((digit, index) => (
          <g key={digit}>
            <text fill={muted} fontSize="5.5" fontWeight="700" textAnchor="middle" x={49 + index * 7} y="15">{digit}</text>
            <text fill={muted} fontSize="5.5" fontWeight="700" textAnchor="middle" x="42" y={23 + index * 7}>{DIGITS[(index + 4) % 10]}</text>
          </g>
        ))}
      </>
    ),
  },
};


/** The three how-it-works steps: friends joining a league, a contest on the calendar, a live leaderboard. */
export type StepPicture = 'league' | 'contest' | 'live';

const STEP_SCENES: Record<StepPicture, Scene> = {
  league: {
    background: tint,
    art: (
      <>
        {([[52, court], [80, gold], [108, red]] as const).map(([x, fill]) => (
          <g key={x}>
            <circle cx={x} cy="40" fill={fill} r="13" />
            <path d={`M${x - 20} 78 Q${x - 20} 56 ${x} 56 Q${x + 20} 56 ${x + 20} 78Z`} fill={fill} />
          </g>
        ))}
        <rect fill={ink} height="14" rx="7" width="68" x="46" y="80" />
        <text fill={card} fontSize="8" fontWeight="700" textAnchor="middle" x="80" y="90">Join the league</text>
      </>
    ),
  },
  contest: {
    background: tint,
    art: (
      <>
        <rect fill={card} height="74" rx="8" stroke={line} width="80" x="40" y="14" />
        <rect fill={red} height="20" rx="8" width="80" x="40" y="14" />
        <rect fill={red} height="8" width="80" x="40" y="26" />
        <text className="font-display" fill={paper} fontSize="9" fontWeight="800" textAnchor="middle" x="80" y="28">APRIL</text>
        <text className="font-display" fill={ink} fontSize="30" fontWeight="900" textAnchor="middle" x="80" y="70">9</text>
        <circle cx="112" cy="80" fill={gold} r="12" />
        <path d="M106 80 l4 4 l8 -9" fill="none" stroke={goldInk} strokeWidth="2.5" />
      </>
    ),
  },
  live: {
    background: tint,
    art: (
      <>
        {[0, 1, 2].map((row) => (
          <g key={row}>
            <rect fill={row === 0 ? gold : card} height="16" rx="4" stroke={line} width="112" x="24" y={24 + row * 22} />
            <text className="font-display" fill={row === 0 ? goldInk : ink} fontSize="9" fontWeight="800" x="32" y={35 + row * 22}>{row + 1}</text>
            {pill(44, 26 + row * 22, [52, 44, 60][row] ?? 0, chip)}
            <path d={['M124 36 l4 -6 l4 6', 'M124 52 l4 6 l4 -6', 'M124 76 l4 -6 l4 6'][row]} fill={[goldInk, red, grass][row]} />
          </g>
        ))}
        <rect fill={red} height="12" rx="6" width="34" x="24" y="6" />
        <circle cx="32" cy="12" fill={paper} r="2.5" />
        <text fill={paper} fontSize="7" fontWeight="800" textAnchor="middle" x="47" y="15">LIVE</text>
      </>
    ),
  },
};

/** A scene's svg: announced by `label` when given, otherwise hidden beside its name. */
function Illustration({ scene, className, label }: { scene: Scene; className?: string; label?: string }) {
  return (
    <svg
      aria-hidden={label === undefined || undefined}
      aria-label={label}
      className={cn('block', className)}
      preserveAspectRatio="xMidYMid slice"
      role={label === undefined ? undefined : 'img'}
      viewBox="0 0 160 100"
    >
      <rect fill={scene.background} height="100" width="160" />
      {scene.art}
    </svg>
  );
}

/** A sport's picture; `decorative` when the sport's name sits beside it. */
export function SportIllustration({ sport, className, decorative = false }: { sport: Sport; className?: string; decorative?: boolean }) {
  return <Illustration className={className} label={decorative ? undefined : SPORT_SCENES[sport].label} scene={SPORT_SCENES[sport]} />;
}

/** A way to play's picture, always beside its name. */
export function FormatIllustration({ selectionType, className }: { selectionType: SelectionType; className?: string }) {
  return <Illustration className={className} scene={FORMAT_SCENES[selectionType]} />;
}

/** A how-it-works step's picture, always beside the step's title. */
export function StepIllustration({ step, className }: { step: StepPicture; className?: string }) {
  return <Illustration className={className} scene={STEP_SCENES[step]} />;
}
