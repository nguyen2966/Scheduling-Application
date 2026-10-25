document.querySelectorAll('[data-create-url]').forEach((column) => {
  column.addEventListener('click', (event) => {
    if (event.target.closest('a, button, input, select, textarea')) return;
    const url = new URL(column.dataset.createUrl, window.location.origin);
    const start = column.closest('[data-range-start]').dataset.rangeStart;
    if (start !== '') {
      const minute = Number(start) + Math.floor((event.clientY - column.getBoundingClientRect().top) / 32) * 30;
      if (minute < 0 || minute >= 1440) return;
      url.searchParams.set('start_time', `${String(Math.floor(minute / 60)).padStart(2, '0')}:${String(minute % 60).padStart(2, '0')}`);
    }
    window.location.assign(url.pathname + url.search);
  });
});
