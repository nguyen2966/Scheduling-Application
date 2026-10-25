import { sendResponse } from '../response.js';

export function createTutorController({ tutorService, now = () => new Date() }) {
  return {
    async list(req, res) {
      const items = await tutorService.listTutors();
      return sendResponse(res, {
        data: { items },
        key: 'TUTORS_RETRIEVED',
        message: 'Tutors retrieved successfully.',
      }, now);
    },
  };
}
