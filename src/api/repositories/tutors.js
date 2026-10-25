export function createTutorRepository({ database }) {
  const selectTutors = database.prepare(
    'SELECT tutor_id, tutor_name, subject, phone FROM tutors ORDER BY tutor_id',
  );
  const selectTutor = database.prepare('SELECT tutor_id, tutor_name, subject, phone FROM tutors WHERE tutor_id = ?');
  return {
    findAll() {
      return selectTutors.all().map((tutor) => ({ ...tutor }));
    },
    findById(tutorId) {
      const tutor = selectTutor.get(tutorId);
      return tutor ? { ...tutor } : null;
    },
  };
}
