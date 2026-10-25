export function createBookingChangeService({ bookingChangeRepository, bookingService }) {
  return {
    async listChanges(lessonId) {
      // Reuse booking ID validation and distinguish a missing booking from empty history.
      await bookingService.getBooking(lessonId);
      const changes = await bookingChangeRepository.findByLessonId(lessonId);
      return changes.map((change) => ({
        ...change,
        before_snapshot: change.before_snapshot === null ? null : JSON.parse(change.before_snapshot),
        after_snapshot: JSON.parse(change.after_snapshot),
        needs_manual_communication: change.needs_manual_communication === null
          ? null : change.needs_manual_communication === 1,
      }));
    },
  };
}
