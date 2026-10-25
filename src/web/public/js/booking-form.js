import { createApiClient } from './api-client.js';
import { createBookingSubmitHandler } from './booking-form-actions.js';

const form = document.querySelector('[data-booking-form]');
if (form) {
  const button = form.querySelector('[data-save-booking]');
  const errorBox = form.querySelector('[data-form-error]');
  const message = form.querySelector('[data-form-error-message]');
  const date = form.elements.namedItem('date');
  function validateDay() {
    const monday = /^\d{4}-\d{2}-\d{2}$/.test(date.value)
      && new Date(`${date.value}T00:00:00Z`).getUTCDay() === 1;
    date.setCustomValidity(monday ? 'The centre is closed on Monday. Choose another date.' : '');
  }
  date.addEventListener('input', validateDay);
  validateDay();
  form.addEventListener('submit', createBookingSubmitHandler({
    client: createApiClient(),
    readValues: () => Object.fromEntries(new FormData(form)),
    setSaving(saving) {
      button.disabled = saving;
      button.textContent = saving ? 'Saving…' : 'Create booking';
      form.setAttribute('aria-busy', String(saving));
    },
    showError(error) {
      errorBox.hidden = !error;
      message.textContent = error?.message || '';
      for (const label of form.querySelectorAll('[data-field-error]')) label.textContent = '';
      for (const field of form.querySelectorAll('[aria-invalid]')) field.removeAttribute('aria-invalid');
      if (!error) return;
      const field = form.elements.namedItem(error.field);
      if (field && typeof field.setAttribute === 'function') field.setAttribute('aria-invalid', 'true');
      for (const label of form.querySelectorAll('[data-field-error]')) {
        if (label.dataset.fieldError === error.field) label.textContent = error.message;
      }
      errorBox.focus();
    },
    navigate: (url) => window.location.assign(url),
  }));
}
