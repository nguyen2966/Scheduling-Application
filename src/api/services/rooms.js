export function createRoomService({ roomRepository }) {
  return {
    listRooms() {
      return roomRepository.findAll();
    },
  };
}
