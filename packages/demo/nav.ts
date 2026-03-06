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

const VFS_NAMES = [
  'default',
  'MemoryVFS',
  'MemoryAsyncVFS',
  'IDBBatchAtomicVFS',
  'IDBMirrorVFS',
  'OPFSAdaptiveVFS',
  'OPFSAnyContextVFS',
  'OPFSCoopSyncVFS',
  'OPFSPermutedVFS',
  'AccessHandlePoolVFS',
];

const BUILD_NAMES = ['default', 'asyncify', 'jspi'];

class DemoNav extends HTMLElement {
  connectedCallback() {
    const path = window.location.pathname;
    const params = new URLSearchParams(location.search);
    const currentVfs = params.get('config') || 'IDBBatchAtomicVFS';
    const currentBuild = params.get('build') || 'asyncify';

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
        demo-nav .config-bar {
          display: flex;
          align-items: center;
          gap: 0.5rem;
          padding: 0.35rem 0;
          border-top: 1px solid #333;
          font-family: sans-serif;
          font-size: 0.82rem;
          color: #aaa;
        }
        demo-nav .config-bar label {
          color: #888;
        }
        demo-nav .config-bar select {
          background: #2d2d2d;
          color: #ccc;
          border: 1px solid #444;
          padding: 0.15rem 0.4rem;
          font-size: 0.82rem;
          border-radius: 3px;
        }
        demo-nav .config-bar button {
          background: #2d2d2d;
          color: #ccc;
          border: 1px solid #444;
          padding: 0.15rem 0.6rem;
          font-size: 0.82rem;
          cursor: pointer;
          border-radius: 3px;
        }
        demo-nav .config-bar button:hover {
          background: #3d3d3d;
          color: #fff;
        }
      </style>
    `;

    const items = LINKS.map(({ href, label }) => {
      const isActive = href === '/'
        ? path === '/' || path === '/index.html'
        : path.startsWith(href);
      const current = isActive ? ' aria-current="page"' : '';
      const p = new URLSearchParams({ config: currentVfs, build: currentBuild });
      return `<a href="${href}?${p}"${current}>${label}</a>`;
    }).join('');

    const vfsOptions = VFS_NAMES.map(name =>
      `<option value="${name}"${name === currentVfs ? ' selected' : ''}>${name}</option>`
    ).join('');

    const buildOptions = BUILD_NAMES.map(name =>
      `<option value="${name}"${name === currentBuild ? ' selected' : ''}>${name}</option>`
    ).join('');

    this.innerHTML = `${style}<nav>${items}</nav>
      <div class="config-bar">
        <label>VFS:</label>
        <select id="nav-vfs-select">${vfsOptions}</select>
        <label>Build:</label>
        <select id="nav-build-select">${buildOptions}</select>
        <button id="nav-apply">Apply</button>
        <button id="nav-reset">Reset storage</button>
      </div>`;

    this.querySelector('#nav-apply')!.addEventListener('click', () => {
      const vfs = (this.querySelector('#nav-vfs-select') as HTMLSelectElement).value;
      const build = (this.querySelector('#nav-build-select') as HTMLSelectElement).value;
      const p = new URLSearchParams(location.search);
      p.set('config', vfs);
      p.set('build', build);
      p.delete('reset');
      location.search = p.toString();
    });

    this.querySelector('#nav-reset')!.addEventListener('click', () => {
      const vfs = (this.querySelector('#nav-vfs-select') as HTMLSelectElement).value;
      const build = (this.querySelector('#nav-build-select') as HTMLSelectElement).value;
      const p = new URLSearchParams(location.search);
      p.set('config', vfs);
      p.set('build', build);
      p.set('reset', '');
      location.search = p.toString();
    });
  }
}

customElements.define('demo-nav', DemoNav);
