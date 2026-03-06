const LINKS = [
  { href: '/',               label: 'SQL Demo' },
  { href: '/hello/',         label: 'Hello' },
  { href: '/benchmarks/',    label: 'Benchmarks' },
  { href: '/contention/',    label: 'Contention' },
  { href: '/write-hint/',    label: 'Write Hint' },
  { href: '/file/',          label: 'File Import/Export' },
  { href: '/SharedService/', label: 'SharedService' },
  { href: '/SharedService-sw/', label: 'SharedService (SW)' },
];

class DemoNav extends HTMLElement {
  connectedCallback() {
    const path = window.location.pathname;

    const style = `
      <style>
        demo-nav {
          display: block;
          background: #1e1e1e;
          padding: 0 1rem;
        }
        demo-nav nav {
          display: flex;
          flex-wrap: wrap;
          gap: 0;
          max-width: 100%;
        }
        demo-nav a {
          color: #ccc;
          text-decoration: none;
          padding: 0.6rem 0.9rem;
          font-family: sans-serif;
          font-size: 0.85rem;
          white-space: nowrap;
          border-bottom: 2px solid transparent;
        }
        demo-nav a:hover {
          color: #fff;
          background: #2d2d2d;
        }
        demo-nav a[aria-current] {
          color: #fff;
          border-bottom-color: #4fc3f7;
        }
      </style>
    `;

    const items = LINKS.map(({ href, label }) => {
      const isActive = href === '/'
        ? path === '/' || path === '/index.html'
        : path.startsWith(href);
      const current = isActive ? ' aria-current="page"' : '';
      return `<a href="${href}"${current}>${label}</a>`;
    }).join('');

    this.innerHTML = `${style}<nav>${items}</nav>`;
  }
}

customElements.define('demo-nav', DemoNav);
