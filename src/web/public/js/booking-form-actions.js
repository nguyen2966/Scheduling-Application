export function bookingInput(values) {
  return {
    student: values.student, tutor_id: values.tutor_id, room: values.room,
    date: values.date, start_time: values.start_time,
    duration_min: /^(60|90)$/.test(values.duration_min) ? Number(values.duration_min) : values.duration_min,
    note: values.note || null,
  };
}

export function createBookingSubmitHandler({ client, readValues, setSaving, showError, navigate }) {
  let saving = false;
  return async function submit(event) {
    event.preventDefault();
    if (saving) return;
    saving = true;
    setSaving(true);
    showError(null);
    try {
      const booking = await client.createBooking(bookingInput(readValues()));
      navigate(`/bookings/${encodeURIComponent(booking.lesson_id)}?created=1`);
    } catch (error) {
      showError({ message: error.status >= 500 || !error.status
        ? "We couldn't confirm the booking. Check the schedule before trying again." : error.message,
      field: error.details?.field || '' });
    } finally {
      saving = false;
      setSaving(false);
    }
  };
}
