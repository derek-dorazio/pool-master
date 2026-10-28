import type { Config } from "tailwindcss";
import tailwindcssAnimate from "tailwindcss-animate";

/**
 * A theme colour that takes Tailwind's opacity modifier (`bg-primary/10`): the token is a whole
 * colour, so the modifier mixes it with transparent.
 */
const themeColor = (token: string) =>
  `color-mix(in srgb, var(--${token}) calc(<alpha-value> * 100%), transparent)`;

const config: Config = {
  darkMode: ["class"],
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    container: {
      center: true,
      padding: "2rem",
      screens: {
        "2xl": "1400px",
      },
    },
    extend: {
      colors: {
        navy: {
          50: "var(--color-navy-50)",
          100: "var(--color-navy-100)",
          200: "var(--color-navy-200)",
          300: "var(--color-navy-300)",
          400: "var(--color-navy-400)",
          500: "var(--color-navy-500)",
          600: "var(--color-navy-600)",
          700: "var(--color-navy-700)",
          800: "var(--color-navy-800)",
          900: "var(--color-navy-900)",
        },
        gold: {
          50: "var(--color-gold-50)",
          100: "var(--color-gold-100)",
          200: "var(--color-gold-200)",
          300: "var(--color-gold-300)",
          400: "var(--color-gold-400)",
          500: "var(--color-gold-500)",
          600: "var(--color-gold-600)",
          700: "var(--color-gold-700)",
        },
        brandRed: {
          50: "var(--color-red-50)",
          100: "var(--color-red-100)",
          200: "var(--color-red-200)",
          300: "var(--color-red-300)",
          400: "var(--color-red-400)",
          500: "var(--color-red-500)",
          600: "var(--color-red-600)",
        },
        chart: {
          1: "var(--chart-series-1)",
          2: "var(--chart-series-2)",
          3: "var(--chart-series-3)",
          4: "var(--chart-series-4)",
          5: "var(--chart-series-5)",
          grid: "var(--chart-grid)",
        },
        podium: {
          1: { DEFAULT: "var(--podium-1-surface)", foreground: "var(--podium-1-text)" },
          2: { DEFAULT: "var(--podium-2-surface)", foreground: "var(--podium-2-text)" },
          3: { DEFAULT: "var(--podium-3-surface)", foreground: "var(--podium-3-text)" },
        },
        paper: "var(--color-paper)",
        ink: "var(--color-ink)",
        surface: {
          canvas: "var(--surface-canvas)",
          raised: "var(--surface-raised)",
          inverse: "var(--surface-inverse)",
          "inverse-deep": "var(--surface-inverse-deep)",
        },
        label: "var(--text-label)",
        "label-on-inverse": "var(--text-label-on-inverse)",
        selected: "var(--surface-selected)",
        "on-inverse": "var(--text-on-inverse)",
        "on-inverse-muted": "var(--text-on-inverse-muted)",
        "on-inverse-subtle": "var(--surface-on-inverse-subtle)",
        "on-inverse-hover": "var(--surface-on-inverse-hover)",
        "inverse-border": "var(--border-on-inverse)",
        border: themeColor("border"),
        input: themeColor("input"),
        ring: themeColor("ring"),
        background: themeColor("background"),
        foreground: themeColor("foreground"),
        primary: {
          DEFAULT: themeColor("primary"),
          foreground: themeColor("primary-foreground"),
        },
        secondary: {
          DEFAULT: themeColor("secondary"),
          foreground: themeColor("secondary-foreground"),
        },
        destructive: {
          DEFAULT: themeColor("destructive"),
          foreground: themeColor("destructive-foreground"),
        },
        muted: {
          DEFAULT: themeColor("muted"),
          foreground: themeColor("muted-foreground"),
        },
        accent: {
          DEFAULT: themeColor("accent"),
          foreground: themeColor("accent-foreground"),
        },
        popover: {
          DEFAULT: themeColor("popover"),
          foreground: themeColor("popover-foreground"),
        },
        card: {
          DEFAULT: themeColor("card"),
          foreground: themeColor("card-foreground"),
        },
      },
      fontFamily: {
        body: ["var(--font-body)"],
        display: ["var(--font-display)"],
        mono: ["var(--font-mono)"],
        numeric: ["var(--font-numeric)"],
      },
      letterSpacing: {
        eyebrow: "var(--tracking-eyebrow)",
        label: "var(--tracking-label)",
        button: "var(--tracking-button)",
      },
      borderRadius: {
        lg: "var(--radius)",
        md: "calc(var(--radius) - 2px)",
        sm: "calc(var(--radius) - 4px)",
        // Every size follows --radius (0.5rem), so a sharper or softer theme is one setting.
        xl: "calc(var(--radius) * 1.5)",
        "2xl": "calc(var(--radius) * 2)",
        "3xl": "calc(var(--radius) * 3)",
        "4xl": "calc(var(--radius) * 4)",
        pill: "9999px",
      },
      boxShadow: {
        sm: "var(--shadow-sm)",
        md: "var(--shadow-md)",
        lg: "var(--shadow-lg)",
        xl: "var(--shadow-xl)",
        "2xl": "var(--shadow-2xl)",
        focus: "var(--shadow-focus)",
        "gold-glow": "var(--shadow-gold-glow)",
        "red-pulse": "var(--shadow-red-pulse)",
      },
      transitionDuration: {
        fast: "var(--duration-fast)",
        base: "var(--duration-base)",
        slow: "var(--duration-slow)",
      },
      transitionTimingFunction: {
        brand: "var(--ease-out)",
        "brand-in-out": "var(--ease-in-out)",
      },
    },
  },
  plugins: [tailwindcssAnimate],
};

export default config;
