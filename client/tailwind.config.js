/** @type {import('tailwindcss').Config} */
// Colors map to the design-system tokens (HSL channels) in src/styles/tokens.css
// so components reference semantic names, never raw hex (the system stays themeable).
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        border: "hsl(var(--border-ch))",
        input: "hsl(var(--input-ch))",
        ring: "hsl(var(--ring-ch))",
        background: "hsl(var(--background-ch))",
        foreground: "hsl(var(--foreground-ch))",
        primary: {
          DEFAULT: "hsl(var(--primary-ch))",
          foreground: "hsl(var(--primary-foreground-ch))",
        },
        secondary: {
          DEFAULT: "hsl(var(--secondary-ch))",
          foreground: "hsl(var(--foreground-ch))",
        },
        muted: {
          DEFAULT: "hsl(var(--muted-ch))",
          foreground: "hsl(var(--muted-foreground-ch))",
        },
        accent: {
          DEFAULT: "hsl(var(--accent-ch))",
          foreground: "hsl(var(--foreground-ch))",
        },
        destructive: {
          DEFAULT: "hsl(var(--destructive-ch))",
          foreground: "#ffffff",
        },
        card: "hsl(var(--card-ch))",
        status: {
          pending: "var(--status-pending)",
          "pending-bg": "var(--status-pending-bg)",
          accepted: "var(--status-accepted)",
          "accepted-bg": "var(--status-accepted-bg)",
          active: "var(--status-active)",
          "active-bg": "var(--status-active-bg)",
          rejected: "var(--status-rejected)",
          "rejected-bg": "var(--status-rejected-bg)",
          neutral: "var(--status-neutral)",
          "neutral-bg": "var(--status-neutral-bg)",
        },
      },
      borderRadius: {
        lg: "var(--radius)",
        md: "calc(var(--radius) - 2px)",
        sm: "calc(var(--radius) - 4px)",
      },
      boxShadow: {
        sm: "var(--shadow-sm)",
        md: "var(--shadow-md)",
        lg: "var(--shadow-lg)",
      },
      fontFamily: {
        sans: "var(--font-sans)",
        mono: "var(--font-mono)",
      },
    },
  },
  plugins: [],
};
