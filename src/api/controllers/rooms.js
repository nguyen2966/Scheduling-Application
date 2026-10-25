import { sendResponse } from '../response.js';

export function createRoomController({ roomService, now = () => new Date() }) {
  return {
    async list(req, res) {
      const items = await roomService.listRooms();
      return sendResponse(res, {
        data: { items },
        key: 'ROOMS_RETRIEVED',
        message: 'Rooms retrieved successfully.',
      }, now);
    },
  };
}
