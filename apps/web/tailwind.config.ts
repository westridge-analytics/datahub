import type { Config } from 'tailwindcss'

// NOTE: Tailwind v4 uses CSS-first configuration via @theme in globals.css.
// This file is kept for editor tooling / legacy plugin support.
// The canonical design tokens live in app/globals.css under @theme.
const config: Config = {
  content: [
    './app/**/*.{ts,tsx}',
    './components/**/*.{ts,tsx}',
    './lib/**/*.{ts,tsx}',
  ],
  theme: {
    extend: {
      colors: {
        canvas: '#F2F4F1',
        surface: '#FFFFFF',
        nav: '#203E46',
        'nav-text': '#7AAEBB',
        'nav-active': '#F2F4F1',
        'text-primary': '#10232B',
        'text-secondary': '#3D5A63',
        'text-tertiary': '#7A9AA4',
        accent: '#6F99CC',
        'accent-mid': '#5580B0',
        'accent-light': '#E4EEF8',
        'accent-border': '#AECAE0',
        warning: '#7A5C3A',
        'warning-light': '#F3EAE0',
        'warning-border': '#C4A882',
        error: '#B83228',
        'error-light': '#FAEBE9',
        'section-header': '#D7E8EE',
        border: '#BDD3DC',
      },
      fontFamily: {
        sans: ['Avenir Next LT Pro', 'system-ui', 'sans-serif'],
      },
      fontSize: {
        table: '12px',
        body: '13px',
      },
    },
  },
  plugins: [],
}

export default config
