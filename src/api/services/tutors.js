export function createTutorService({ tutorRepository }) {
  return {
    listTutors() {
      return tutorRepository.findAll();
    },
  };
}
