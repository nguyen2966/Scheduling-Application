const dialog = document.querySelector('[data-booking-details]');
if (dialog && typeof dialog.showModal === 'function') {
  const closeLink = dialog.querySelector('[data-close-details]');
  dialog.close();
  dialog.showModal();
  dialog.addEventListener('cancel', (event) => {
    event.preventDefault();
    window.location.assign(closeLink.href);
  });
}
