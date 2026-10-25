export function createRoomRepository({ database }) {
  const selectRooms = database.prepare('SELECT room_id FROM rooms ORDER BY room_id');
  return {
    findAll() {
      return selectRooms.all().map((room) => ({ ...room }));
    },
  };
}
