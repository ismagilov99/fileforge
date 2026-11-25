export function setupTabs(): void {
  const tabs = Array.from(document.querySelectorAll<HTMLButtonElement>('.tab'));
  const activate = (name: string, focus = false) => {
    for (const tab of tabs) {
      const active = tab.dataset['tab'] === name;
      tab.classList.toggle('active', active);
      tab.setAttribute('aria-selected', String(active));
      tab.tabIndex = active ? 0 : -1;
      if (active && focus) tab.focus();
    }
    for (const panel of document.querySelectorAll<HTMLElement>('.panel')) {
      const active = panel.id === `panel-${name}`;
      panel.classList.toggle('active', active);
      panel.hidden = !active;
    }
  };

  tabs.forEach((tab, index) => {
    tab.addEventListener('click', () => activate(tab.dataset['tab'] ?? 'images'));
    tab.addEventListener('keydown', (event: KeyboardEvent) => {
      if (!['ArrowRight', 'ArrowLeft', 'Home', 'End'].includes(event.key)) return;
      event.preventDefault();
      const next =
        event.key === 'Home'
          ? 0
          : event.key === 'End'
            ? tabs.length - 1
            : event.key === 'ArrowRight'
              ? (index + 1) % tabs.length
              : (index - 1 + tabs.length) % tabs.length;
      activate(tabs[next]!.dataset['tab'] ?? 'images', true);
    });
  });
}
